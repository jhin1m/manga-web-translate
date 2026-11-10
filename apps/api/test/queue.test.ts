/** Hàng đợi: idempotency, claim song song không trùng, worker chung mọi người dùng, lọc capability / pipeline_version. */
import { chapters, jobs, pages, scoped, series } from "@mtl/db";
import { type JobPayload, pageId } from "@mtl/shared";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueueExport, INTERACTIVE_PRIORITY, inJobTx, insertJob } from "../src/jobs/enqueue.ts";
import { compareVersion } from "../src/jobs/queue.ts";
import { reapExpiredLeases } from "../src/jobs/reaper.ts";
import { CHAIN_PRIORITY } from "../src/jobs/translate-chain.ts";
import { db, seedUser } from "./helpers.ts";
import { cancelActiveJobs } from "./isolate-queue.ts";
import { claimJobs, expireLease, jobRow, SHA, VERSION, wcall, workerToken } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
let A: Seed;
let B: Seed;

const exportPayload = (chapterId: string): Extract<JobPayload, { type: "chapter.export" }> => ({
  type: "chapter.export",
  chapter_id: chapterId,
  format: "cbz",
  layout: "pages",
  quality: 90,
  include_untranslated: true,
});

/** Job chapter.export — inputs chỉ cần chương có ≥ 1 page (seedPage), không cần ảnh thật để kiểm claim. */
async function addExportJobs(seed: Seed, n: number, key = () => uuidv7()) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const { job } = await inJobTx((tx) =>
      insertJob(tx, {
        userId: seed.userId,
        payload: exportPayload(seed.chapterId),
        key: { inputRev: "r", idempotencyKey: key() },
        chapterId: seed.chapterId,
      }),
    );
    ids.push(job.id);
  }
  return ids;
}

async function seedPage(seed: Seed) {
  await scoped(db, seed.userId).insert(pages, {
    id: pageId(seed.chapterId, 1, 0),
    chapterId: seed.chapterId,
    ord: 0,
    width: 100,
    height: 100,
    originalKey: `u/${seed.userId}/ch/${seed.chapterId}/ingest/1/0.png`,
    originalSha256: SHA,
  });
}

beforeAll(async () => {
  [A, B] = await Promise.all([seedUser("qa"), seedUser("qb")]);
  await Promise.all([A, B].map(seedPage));
});

// Worker chung: mỗi ca chỉ thấy job của chính nó.
beforeEach(cancelActiveJobs);

describe("enqueue idempotency", () => {
  it("returns the same job while active, creates a new one after the old failed", async () => {
    const key = uuidv7();
    const [first] = await addExportJobs(A, 1, () => key);
    const [again] = await addExportJobs(A, 1, () => key);
    expect(again).toBe(first);
    await db
      .update(jobs)
      .set({ status: "failed" })
      .where(eq(jobs.id, first as string));
    const [fresh] = await addExportJobs(A, 1, () => key);
    expect(fresh).not.toBe(first);
  });
});

describe("claim", () => {
  it("2 workers claiming 1000 jobs concurrently never get the same job", async () => {
    const W = await seedUser("q1000");
    await seedPage(W);
    const ids = new Set(await addExportJobs(W, 1000));
    const t1 = (await workerToken("mac", "w1")).token;
    const t2 = (await workerToken("mac", "w2")).token;
    const seen: string[] = [];
    const drain = async (tk: string) => {
      for (;;) {
        const got = await claimJobs(tk, { caps: ["chapter.export"], max: 8 });
        if (got.length === 0) return;
        seen.push(...got.map((j) => j.id));
      }
    };
    await Promise.all([drain(t1), drain(t2), drain(t1), drain(t2)]);
    expect(seen).toHaveLength(1000);
    expect(new Set(seen).size).toBe(1000);
    expect(seen.every((id) => ids.has(id))).toBe(true);
  }, 120_000);

  it("claims same-timestamp page.prepare jobs in page order, whatever the insert order", async () => {
    const O = await seedUser("qord");
    const N = 5;
    const ids = Array.from({ length: N }, (_, ord) => pageId(O.chapterId, 1, ord));
    const at = new Date(Date.now() - 60_000);
    for (let ord = N - 1; ord >= 0; ord--) {
      const id = ids[ord] as string;
      await scoped(db, O.userId).insert(pages, {
        id,
        chapterId: O.chapterId,
        ord,
        width: 100,
        height: 100,
        originalKey: `u/${O.userId}/ch/${O.chapterId}/ingest/1/${ord}.png`,
        originalSha256: SHA,
      });
      await db.insert(jobs).values({
        userId: O.userId,
        type: "page.prepare",
        // Chỉ page_id được claim đọc; phần còn lại của payload không ảnh hưởng thứ tự.
        payload: { type: "page.prepare", page_id: id } as unknown as JobPayload,
        inputRev: "r",
        idempotencyKey: uuidv7(),
        chapterId: O.chapterId,
        pageId: id,
        createdAt: at,
      });
    }
    const mac = (await workerToken("mac", "w-ord")).token;
    const got = await claimJobs(mac, { caps: ["page.prepare"], max: N });
    expect(got.map((j) => String(j.payload.page_id))).toEqual(ids);
  });

  it("claims a finished chapter's export before another chapter's prepare and translate backlog", async () => {
    // Bộ 1 đã xong, bấm xuất trong lúc bộ 2 còn 5 trang chờ xoá chữ (tạo trước) và 1 lô dịch (tạo sau export).
    const P = await seedUser("qprio");
    await seedPage(P);
    const sdb = scoped(db, P.userId);
    const s2 = await sdb.insert(series, { title: "Series qprio 2" });
    const ch2 = await sdb.insert(chapters, { seriesId: s2.id, number: "1" });
    const at = new Date(Date.now() - 60_000);
    const s2Job = async (ord: number, priority: number, createdAt?: Date) => {
      const id = pageId(ch2.id, 1, ord);
      await sdb.insert(pages, {
        id,
        chapterId: ch2.id,
        ord,
        width: 100,
        height: 100,
        originalKey: `u/${P.userId}/ch/${ch2.id}/ingest/1/${ord}.png`,
        originalSha256: SHA,
      });
      // Thứ tự claim chỉ xét priority + created_at → lô dịch mang priority thật nhưng chạy dưới dạng page.prepare
      // (claim chapter.translate cần trang đã prepare, ngoài phạm vi ca này).
      const [row] = await db
        .insert(jobs)
        .values({
          userId: P.userId,
          type: "page.prepare",
          payload: { type: "page.prepare", page_id: id } as unknown as JobPayload,
          inputRev: "r",
          idempotencyKey: uuidv7(),
          chapterId: ch2.id,
          pageId: id,
          priority,
          ...(createdAt ? { createdAt } : {}),
        })
        .returning({ id: jobs.id });
      return row?.id as string;
    };
    const backlog: string[] = [];
    for (let ord = 0; ord < 5; ord++) backlog.push(await s2Job(ord, 100, at));
    // Qua enqueueExport thật: bỏ priority ở đó thì ca này đỏ.
    const { job: ex } = await inJobTx((tx) => enqueueExport(tx, P.userId, exportPayload(P.chapterId)));
    expect(ex.priority).toBe(INTERACTIVE_PRIORITY);
    const batch = await s2Job(5, CHAIN_PRIORITY);

    const mac = (await workerToken("mac", "w-prio")).token;
    const order: string[] = [];
    for (let i = 0; i < 7; i++) {
      const got = await claimJobs(mac, { caps: ["page.prepare", "chapter.export"], max: 1 });
      order.push(...got.map((j) => j.id));
    }
    expect(order).toEqual([ex.id, batch, ...backlog]);
  });

  it("mac and modal tokens both claim jobs of every user (shared workers)", async () => {
    const mac = (await workerToken("mac", "mac-any")).token;
    const modal = (await workerToken("modal", "modal-any")).token;
    for (const tk of [mac, modal]) {
      const [aJob] = await addExportJobs(A, 1);
      const [bJob] = await addExportJobs(B, 1);
      const got = (await claimJobs(tk, { caps: ["chapter.export"], max: 8 })).map((j) => j.id);
      expect(got).toEqual(expect.arrayContaining([aJob, bJob]));
    }
  });

  it("rejects old pipeline_version (426) and unknown/disallowed capabilities (400)", async () => {
    const tA = (await workerToken("mac", "caps", ["page.prepare"])).token;
    const body = { worker_id: "x", max: 1, dispatch_id: null };
    expect(
      (await wcall(tA, "/claim", { ...body, capabilities: ["page.prepare"], pipeline_version: "0.2.9" })).status,
    ).toBe(426);
    expect((await wcall(tA, "/claim", { ...body, capabilities: ["bogus"], pipeline_version: VERSION })).status).toBe(
      400,
    );
    expect(
      (await wcall(tA, "/claim", { ...body, capabilities: ["chapter.export"], pipeline_version: VERSION })).status,
    ).toBe(400);
  });

  it("compares versions numerically", () => {
    expect(compareVersion("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersion("0.3.0", "0.3.0")).toBe(0);
    expect(compareVersion("0.2.9", "0.3.0")).toBe(-1);
  });
});

describe("reaper", () => {
  it("fails a job whose lease expired on its last attempt", async () => {
    const W = await seedUser("reap");
    await seedPage(W);
    const [id] = await addExportJobs(W, 1);
    await db
      .update(jobs)
      .set({ maxAttempts: 1 })
      .where(eq(jobs.id, id as string));
    const tk = (await workerToken("mac")).token;
    const [j] = await claimJobs(tk, { caps: ["chapter.export"] });
    expect(j?.id).toBe(id);
    await expireLease(id as string);
    await reapExpiredLeases();
    const row = await jobRow(id as string);
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/lease expired/);
    const running = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, W.userId), eq(jobs.status, "running")));
    expect(running).toEqual([]);
  });
});
