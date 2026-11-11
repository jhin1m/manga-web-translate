/**
 * Hàng đợi: idempotency, claim song song không trùng, thứ tự claim (priority, chia lượt giữa các chương, thứ tự trang),
 * worker chung mọi người dùng, lọc capability / pipeline_version.
 */
import { chapters, jobs, pages, scoped, series } from "@mtl/db";
import { type JobPayload, pageId } from "@mtl/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../src/env.ts";
import { enqueueExport, INTERACTIVE_PRIORITY, inJobTx, insertJob } from "../src/jobs/enqueue.ts";
import { CLAIM_LOOKAHEAD, compareVersion, pickClaimableSql } from "../src/jobs/queue.ts";
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

/** Chương mới của `userId` (bộ riêng) — mỗi ca chia lượt cần nhiều chương của cùng một người. */
async function newChapter(userId: string, label: string) {
  const sdb = scoped(db, userId);
  const s = await sdb.insert(series, { title: `Series ${label}` });
  return (await sdb.insert(chapters, { seriesId: s.id, number: "1" })).id;
}

/** Trang `ord` của chương + job page.prepare đang chờ cho trang đó. */
async function prepareJob(
  userId: string,
  chapterId: string,
  ord: number,
  opts: { createdAt?: Date; priority?: number } = {},
) {
  const id = pageId(chapterId, 1, ord);
  await scoped(db, userId).insert(pages, {
    id,
    chapterId,
    ord,
    width: 100,
    height: 100,
    originalKey: `u/${userId}/ch/${chapterId}/ingest/1/${ord}.png`,
    originalSha256: SHA,
  });
  const [row] = await db
    .insert(jobs)
    .values({
      userId,
      type: "page.prepare",
      // Chỉ page_id được claim đọc; phần còn lại của payload không ảnh hưởng thứ tự.
      payload: { type: "page.prepare", page_id: id } as unknown as JobPayload,
      inputRev: "r",
      idempotencyKey: uuidv7(),
      chapterId,
      pageId: id,
      ...opts,
    })
    .returning({ id: jobs.id });
  return row?.id as string;
}

/**
 * Chương có `n` trang, mỗi trang một job page.prepare cùng `createdAt` (như ingest tạo cả loạt trong một transaction).
 * `createdAt` đặt tường minh: hai chương phải cách nhau rõ ràng, không rơi xuống so `id`.
 */
async function chapterWithPrepare(userId: string, label: string, n: number, createdAt: Date) {
  const chapterId = await newChapter(userId, label);
  const jobIds: string[] = [];
  for (let ord = 0; ord < n; ord++) jobIds.push(await prepareJob(userId, chapterId, ord, { createdAt }));
  return { chapterId, jobIds };
}

/** Job đang chạy (lease còn hạn) chèn thẳng vào DB: làm chương "bận" mà không cần claim thật. */
async function runningJob(userId: string, chapterId: string, leaseOwner: string) {
  await db.insert(jobs).values({
    userId,
    type: "chapter.translate",
    status: "running",
    priority: CHAIN_PRIORITY,
    payload: { type: "chapter.translate", chapter_id: chapterId, page_ids: [] } as unknown as JobPayload,
    inputRev: "r",
    idempotencyKey: uuidv7(),
    chapterId,
    leaseOwner,
    leaseExpiresAt: new Date(Date.now() + 120_000),
  });
}

const ago = (s: number) => new Date(Date.now() - s * 1000);
const finish = (id: string) => db.update(jobs).set({ status: "succeeded" }).where(eq(jobs.id, id));
const claimOne = async (token: string, caps = ["page.prepare"]) => (await claimJobs(token, { caps, max: 1 }))[0]?.id;

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

  it("shares claims between chapters: the later chapter starts on the second claim, pages stay in order", async () => {
    const U = await seedUser("qshare");
    const a = await chapterWithPrepare(U.userId, "share-a", 20, ago(120));
    const b = await chapterWithPrepare(U.userId, "share-b", 5, ago(60));
    const mac = (await workerToken("mac", "w-share")).token;
    // Không job nào kết thúc: mỗi lượt claim làm chương đó "bận" thêm một job.
    const order: (string | undefined)[] = [];
    for (let i = 0; i < 25; i++) order.push(await claimOne(mac));
    const turns = [0, 1, 2, 3, 4].flatMap((i) => [a.jobIds[i], b.jobIds[i]]);
    expect(order).toEqual([...turns, ...a.jobIds.slice(5)]);
    expect(await claimOne(mac)).toBeUndefined();
  });

  it("two workers each stay on their own chapter until the shorter one runs out", async () => {
    const U = await seedUser("qtwo");
    const a = await chapterWithPrepare(U.userId, "two-a", 20, ago(120));
    const b = await chapterWithPrepare(U.userId, "two-b", 5, ago(60));
    const w1 = (await workerToken("mac", "w-two-1")).token;
    const w2 = (await workerToken("mac", "w-two-2")).token;
    const got: Record<string, string[]> = { [w1]: [], [w2]: [] };
    const holding: Record<string, string | undefined> = {};
    // Mỗi worker: xong job đang giữ rồi mới claim tiếp, hai worker luân phiên.
    for (let round = 0; round < 14; round++) {
      for (const w of [w1, w2]) {
        if (holding[w]) await finish(holding[w]);
        holding[w] = await claimOne(w);
        if (holding[w]) got[w]?.push(holding[w]);
      }
    }
    expect(got[w1]).toHaveLength(13);
    expect(got[w1]?.every((id) => a.jobIds.includes(id))).toBe(true);
    expect(got[w2]?.slice(0, 5)).toEqual(b.jobIds);
    expect(got[w2]?.slice(5).every((id) => a.jobIds.includes(id))).toBe(true);
    // Cả hai worker gộp lại: đủ 20 trang của chương dài, đúng thứ tự trang.
    const claimedAt = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.chapterId, a.chapterId))
      .orderBy(jobs.claimedAt);
    expect(claimedAt.map((r) => r.id)).toEqual(a.jobIds);
  });

  it("priority still comes first: an urgent job of a busy chapter beats a normal job of an idle one", async () => {
    const U = await seedUser("qbusyprio");
    const a = await chapterWithPrepare(U.userId, "prio-a", 1, ago(120));
    const mac = (await workerToken("mac", "w-busyprio")).token;
    expect(await claimOne(mac)).toBe(a.jobIds[0]);
    const idle = await chapterWithPrepare(U.userId, "prio-b", 1, ago(60));
    const urgent = await prepareJob(U.userId, a.chapterId, 1, { priority: CHAIN_PRIORITY });
    expect(await claimOne(mac)).toBe(urgent);
    expect(await claimOne(mac)).toBe(idle.jobIds[0]);
  });

  it("a running job whose lease expired does not make its chapter wait", async () => {
    const U = await seedUser("qlease");
    const a = await chapterWithPrepare(U.userId, "lease-a", 2, ago(120));
    const b = await chapterWithPrepare(U.userId, "lease-b", 1, ago(60));
    const mac = (await workerToken("mac", "w-lease")).token;
    expect(await claimOne(mac)).toBe(a.jobIds[0]);
    await expireLease(a.jobIds[0] as string);
    expect(await claimOne(mac)).toBe(a.jobIds[1]);
    expect(await claimOne(mac)).toBe(b.jobIds[0]);
  });

  it("a running job of any type and priority counts: a chapter mid-translation waits behind an idle chapter", async () => {
    const U = await seedUser("qanytype");
    const a = await chapterWithPrepare(U.userId, "any-a", 1, ago(120));
    const b = await chapterWithPrepare(U.userId, "any-b", 1, ago(60));
    const mac = await workerToken("mac", "w-anytype");
    await db.insert(jobs).values({
      userId: U.userId,
      type: "chapter.translate",
      status: "running",
      priority: CHAIN_PRIORITY,
      payload: { type: "chapter.translate", chapter_id: a.chapterId, page_ids: [] } as unknown as JobPayload,
      inputRev: "r",
      idempotencyKey: uuidv7(),
      chapterId: a.chapterId,
      leaseOwner: mac.id,
      leaseExpiresAt: new Date(Date.now() + 120_000),
    });
    expect(await claimOne(mac.token)).toBe(b.jobIds[0]);
    expect(await claimOne(mac.token)).toBe(a.jobIds[0]);
  });

  it("a job without a chapter is ordered like an idle chapter", async () => {
    const U = await seedUser("qnochapter");
    const a = await chapterWithPrepare(U.userId, "nochapter-a", 2, ago(120));
    const mac = (await workerToken("mac", "w-nochapter")).token;
    expect(await claimOne(mac)).toBe(a.jobIds[0]);
    // Cột chapter_id để trống (payload vẫn trỏ chương có trang để dựng được input), tạo sau job còn chờ của chương.
    const [loose] = await db
      .insert(jobs)
      .values({
        userId: U.userId,
        type: "chapter.export",
        payload: exportPayload(a.chapterId),
        inputRev: "r",
        idempotencyKey: uuidv7(),
        chapterId: null,
      })
      .returning({ id: jobs.id });
    const caps = ["page.prepare", "chapter.export"];
    expect(await claimOne(mac, caps)).toBe(loose?.id);
    expect(await claimOne(mac, caps)).toBe(a.jobIds[1]);
  });

  it("skips rows at the head that another transaction holds locked and returns the next job in order", async () => {
    const U = await seedUser("qlocked");
    const a = await chapterWithPrepare(U.userId, "locked-a", 6, ago(120));
    const mac = (await workerToken("mac", "w-locked")).token;
    // Kết nối thứ hai giữ khoá 3 trang đầu (như một lượt claim khác chưa commit) trong lúc worker này claim.
    await db.transaction(async (other) => {
      await other
        .select({ id: jobs.id })
        .from(jobs)
        .where(inArray(jobs.id, a.jobIds.slice(0, 3)))
        .for("update");
      // Chương chưa có job chạy → ứng viên đi theo đầu hàng đợi.
      expect(await claimOne(mac)).toBe(a.jobIds[3]);
      // Chương đã có job chạy → ứng viên là job của chương đang bận.
      expect(await claimOne(mac)).toBe(a.jobIds[4]);
    });
    expect(await claimOne(mac)).toBe(a.jobIds[0]);
  });

  it("an idle chapter is found behind a long backlog of a busy chapter at the head of the queue", async () => {
    const U = await seedUser("qbehind");
    const mac = await workerToken("mac", "w-behind");
    // Số job chờ của chương bận nhiều hơn số dòng một lượt claim đọc ở đầu hàng.
    const a = await chapterWithPrepare(U.userId, "behind-a", CLAIM_LOOKAHEAD + 8, ago(120));
    await runningJob(U.userId, a.chapterId, mac.id);
    const b = await chapterWithPrepare(U.userId, "behind-b", 1, ago(60));
    expect(await claimOne(mac.token)).toBe(b.jobIds[0]);
    expect(await claimOne(mac.token)).toBe(a.jobIds[0]);
  });

  it("when every waiting chapter is busy, the one with fewer running jobs goes first", async () => {
    const U = await seedUser("qallbusy");
    const mac = await workerToken("mac", "w-allbusy");
    // Chương bận hơn tạo trước và có nhiều job chờ hơn số dòng một lượt claim đọc: chương kia vẫn phải được thấy.
    const a = await chapterWithPrepare(U.userId, "allbusy-a", CLAIM_LOOKAHEAD + 8, ago(120));
    const b = await chapterWithPrepare(U.userId, "allbusy-b", 2, ago(60));
    await runningJob(U.userId, a.chapterId, mac.id);
    await runningJob(U.userId, a.chapterId, mac.id);
    await runningJob(U.userId, b.chapterId, mac.id);
    // A: 2 job chạy, B: 1 → B trước dù A tạo trước; sau đó hoà 2–2 → A (tạo trước); rồi A 3, B 2 → B.
    expect(await claimOne(mac.token)).toBe(b.jobIds[0]);
    expect(await claimOne(mac.token)).toBe(a.jobIds[0]);
    expect(await claimOne(mac.token)).toBe(b.jobIds[1]);
    expect(await claimOne(mac.token)).toBe(a.jobIds[1]);
  });

  it("4 concurrent claimers over 6 chapters get every job exactly once", async () => {
    const U = await seedUser("qmany");
    const all: string[] = [];
    for (let c = 0; c < 6; c++) {
      all.push(...(await chapterWithPrepare(U.userId, `many-${c}`, 20, ago(600 - c * 60))).jobIds);
    }
    const t1 = (await workerToken("mac", "w-many-1")).token;
    const t2 = (await workerToken("mac", "w-many-2")).token;
    const seen: string[] = [];
    // claimJobs ném lỗi khi response khác 200 → một request lỗi (deadlock, 500) làm ca này đỏ.
    const drain = async (tk: string) => {
      for (;;) {
        const id = await claimOne(tk);
        if (!id) return;
        seen.push(id);
      }
    };
    // Không kiểm phân bố theo chương: hai claim trùng thời điểm được phép vào cùng một chương.
    await Promise.all([drain(t1), drain(t2), drain(t1), drain(t2)]);
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect([...seen].sort()).toEqual([...all].sort());
  }, 120_000);

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

describe("job selection plan", () => {
  type PlanNode = {
    "Node Type": string;
    "Index Name"?: string;
    "Actual Rows"?: number;
    Plans?: PlanNode[];
  };
  const walk = (n: PlanNode): PlanNode[] => [n, ...(n.Plans ?? []).flatMap(walk)];

  it("walks the claim index from the head and stops early, with every row filter switched on", async () => {
    const U = await seedUser("qplan");
    const QUEUED = 3000;
    // Một người, hàng đợi dài như self-host: 75 chương × 40 job, mỗi chương một created_at.
    await db.execute(sql`
      with ch as (
        insert into chapters (id, series_id, number, user_id)
        select gen_random_uuid(), ${U.seriesId}, 1000 + c, ${U.userId} from generate_series(1, ${QUEUED / 40}) c
        returning id, number
      )
      insert into jobs (id, user_id, type, payload, input_rev, idempotency_key, chapter_id, created_at)
      select gen_random_uuid(), ${U.userId}, 'chapter.export', ${JSON.stringify(exportPayload(U.chapterId))}::jsonb, 'r',
             gen_random_uuid()::text, ch.id, now() - interval '1 day' + ch.number * interval '1 second'
      from ch, generate_series(1, 40)`);
    await db.execute(sql`analyze jobs`);
    env.USER_DAILY_USD = 1000;
    try {
      // Bật mọi bộ lọc theo dòng (hạn mức, breaker, chặn job LLM): không cái nào được làm planner bỏ đường đi theo index.
      const query = pickClaimableSql({
        kind: "modal",
        caps: ["chapter.export", "page.prepare"],
        blockLlm: true,
        paused: ["env", uuidv7()],
        max: 1,
      });
      let nodes: PlanNode[] = [];
      await db
        .transaction(async (t) => {
          const rows = await t.execute<{ "QUERY PLAN": [{ Plan: PlanNode }] }>(
            sql`explain (analyze, format json) ${query}`,
          );
          nodes = walk((rows[0] as { "QUERY PLAN": [{ Plan: PlanNode }] })["QUERY PLAN"][0].Plan);
          // EXPLAIN ANALYZE chạy thật câu lệnh (khoá 1 dòng) → bỏ transaction.
          t.rollback();
        })
        .catch(() => {});
      const head = nodes.filter((n) => n["Index Name"] === "jobs_claim_idx");
      expect(head.map((n) => n["Node Type"])).toEqual(["Index Scan"]);
      // Dừng sớm: chỉ đọc cỡ số dòng đọc trước, không đọc cả hàng đợi.
      expect(head[0]?.["Actual Rows"]).toBeLessThan(CLAIM_LOOKAHEAD * 4);
    } finally {
      env.USER_DAILY_USD = undefined;
    }
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
