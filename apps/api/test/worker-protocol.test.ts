/**
 * Luồng đầy đủ qua HTTP: commit → chapter.ingest → page.prepare × 40 (song song) → chapter.translate → review.
 * Worker giả lập gọi đúng giao thức (fencing, presigned PUT thật vào MinIO).
 */
import { chapters, jobs, pageStates, usageLedger } from "@mtl/db";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { enqueueIngest, inJobTx } from "../src/jobs/enqueue.ts";
import { retranslate } from "../src/jobs/translate-chain.ts";
import { call, db, seedUser } from "./helpers.ts";
import { cancelActiveJobs } from "./isolate-queue.ts";
import {
  addSources,
  aiState,
  claimJobs,
  complete,
  doIngest,
  doPrepare,
  doTranslate,
  failJob,
  pageRows,
  translateIfPrepared,
  usage,
  workerToken,
} from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
let A: Seed;
let token: string;
const N = 40;

beforeAll(async () => {
  A = await seedUser("proto");
  token = (await workerToken("mac")).token;
  await addSources(A.userId, A.chapterId, N);
});

async function progress() {
  const res = await call(`/api/chapters/${A.chapterId}/progress`, { cookie: A.cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    chapter: { status: string };
    counts: Record<string, number>;
    pages: { id: string; status: string; job: { type: string; status: string } | null }[];
  };
}

describe("worker protocol end-to-end", () => {
  it("rejects missing/invalid worker tokens", async () => {
    const res = await call("/worker/v1/claim", { method: "POST", body: {}, headers: { authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
  });

  it(`processes a ${N}-slice chapter to review with 0 stuck jobs`, async () => {
    const { job: ingest, created } = await inJobTx((tx) => enqueueIngest(tx, A.userId, A.chapterId));
    expect(created).toBe(true);
    expect((await progress()).chapter.status).toBe("ingesting");

    const [ij] = await claimJobs(token, { caps: ["chapter.ingest"] });
    expect(ij?.id).toBe(ingest.id);
    expect((ij?.inputs as { sources?: unknown[] } | undefined)?.sources).toHaveLength(N);
    const ir = await doIngest(token, ij as NonNullable<typeof ij>);
    expect(ir.status, await ir.clone().text()).toBe(200);

    let p = await progress();
    expect(p.chapter.status).toBe("processing");
    expect(p.pages).toHaveLength(N);
    expect(p.counts.pending).toBe(N);

    // Giai đoạn 1 song song: 2 worker (cùng token) claim theo lô.
    let done = 0;
    let seq = 1;
    while (done < N) {
      const batch = await claimJobs(token, { caps: ["page.prepare"], max: 8 });
      if (batch.length === 0) break;
      const results = await Promise.all(batch.map((j) => doPrepare(token, j, usage(seq++))));
      for (const r of results) expect(r.status).toBe(200);
      done += batch.length;
    }
    expect(done).toBe(N);

    // Xong bước 1: chương dừng chờ "Dịch", chưa có chapter.translate; bấm Dịch → chuỗi lô ≤ 4 trang, từng job một.
    p = await progress();
    expect(p.counts.prepared).toBe(N);
    expect(p.chapter.status).toBe("prepared");
    const before = await db.select().from(jobs).where(eq(jobs.chapterId, A.chapterId));
    expect(before.filter((j) => j.type === "chapter.translate")).toHaveLength(0);
    await translateIfPrepared(A.chapterId);
    const translates = await db.select().from(jobs).where(eq(jobs.chapterId, A.chapterId));
    expect(translates.filter((j) => j.type === "chapter.translate")).toHaveLength(1);

    const contexts: unknown[] = [];
    for (;;) {
      const [tj] = await claimJobs(token, { caps: ["chapter.translate"] });
      if (!tj) break;
      contexts.push(tj.payload.context);
      expect((tj.inputs as { pages?: unknown[] }).pages).toHaveLength(4);
      const tr = await doTranslate(token, tj);
      expect(tr.status, await tr.clone().text()).toBe(200);
    }
    expect(contexts).toEqual(["rolling", ...Array(N / 4 - 1).fill("neighbors")]);

    p = await progress();
    expect(p.chapter.status).toBe("review");
    expect(p.counts.ready).toBe(N);
    const stuck = await db
      .select()
      .from(jobs)
      .where(inArray(jobs.status, ["queued", "running"]));
    expect(stuck.filter((j) => j.userId === A.userId)).toEqual([]);

    const states = await db.select().from(pageStates).where(eq(pageStates.userId, A.userId));
    expect(
      states.every((s) => s.aiRev === 1 && s.version === 1 && s.state?.regions[0]?.translation === "Xin chào"),
    ).toBe(true);
    const ledger = await db.select().from(usageLedger).where(eq(usageLedger.userId, A.userId));
    expect(ledger.filter((l) => l.kind === "pages")).toHaveLength(N);
    expect(ledger.filter((l) => l.kind === "llm_tokens_in")).toHaveLength(N);
  });

  it("manga (ingest từng trang) tự sang dịch theo lô khi trang xong bước 1; trang lỗi không chặn phần còn lại", async () => {
    for (const [label, failLast] of [
      ["manga-ok", false],
      ["manga-fail", true],
    ] as const) {
      const M = await seedUser(label);
      await addSources(M.userId, M.chapterId, 3);
      await inJobTx((tx) => enqueueIngest(tx, M.userId, M.chapterId, "pages"));
      const [ij] = await claimJobs(token, { caps: ["chapter.ingest"] });
      expect((await doIngest(token, ij as NonNullable<typeof ij>)).status).toBe(200);
      const ids = (await pageRows(M.chapterId)).map((r) => r.id);
      const batch = await claimJobs(token, { caps: ["page.prepare"], max: 3 });
      expect(batch).toHaveLength(3);
      const prep = ids.map((id) => batch.find((j) => j.payload.page_id === id) as NonNullable<(typeof batch)[0]>);
      const translates = async () =>
        (await db.select().from(jobs).where(eq(jobs.chapterId, M.chapterId))).filter(
          (j) => j.type === "chapter.translate" && j.status === "queued",
        );
      // Trang đầu xong bước 1 → lô đầu chạy ngay.
      expect((await doPrepare(token, prep[0] as NonNullable<(typeof prep)[0]>)).status).toBe(200);
      const [lot1] = await translates();
      expect((lot1?.payload as { page_ids: string[] } | undefined)?.page_ids).toEqual([ids[0]]);
      expect((await doPrepare(token, prep[1] as NonNullable<(typeof prep)[0]>)).status).toBe(200);
      const last = prep[2] as NonNullable<(typeof prep)[0]>;
      expect((failLast ? await failJob(token, last, "invalid_input") : await doPrepare(token, last)).status).toBe(200);
      const [ch] = await db.select().from(chapters).where(eq(chapters.id, M.chapterId));
      expect(ch?.status).toBe("processing");

      const [tj] = await claimJobs(token, { caps: ["chapter.translate"] });
      expect(tj?.id).toBe(lot1?.id);
      expect((await doTranslate(token, tj as NonNullable<typeof tj>)).status).toBe(200);
      const [lot2, ...more] = await translates();
      expect(more).toHaveLength(0);
      expect(lot2?.payload).toMatchObject({ context: "neighbors" });
      expect((lot2?.payload as { page_ids: string[] } | undefined)?.page_ids).toEqual(
        failLast ? [ids[1]] : [ids[1], ids[2]],
      );
      await cancelActiveJobs(); // worker dùng chung: lô dịch còn chờ không được lọt sang vòng/ca sau
    }
  });

  it("re-running translate on a hand-edited page keeps state and flags ai_update_available", async () => {
    const [first] = await pageRows(A.chapterId);
    if (!first) throw new Error("no pages");
    const [before] = await db.select().from(pageStates).where(eq(pageStates.pageId, first.id));
    const edited = { ...(before?.state as NonNullable<NonNullable<typeof before>["state"]>) };
    edited.regions = edited.regions.map((r) => ({ ...r, translation: "Bản sửa tay" }));
    await db
      .update(pageStates)
      .set({ state: edited, stateOrigin: "user", version: (before?.version ?? 0) + 1 })
      .where(eq(pageStates.pageId, first.id));

    await inJobTx((tx) => retranslate(tx, A.userId, A.chapterId, [first.id]));
    const [tj] = await claimJobs(token, { caps: ["chapter.translate"] });
    expect(tj?.payload.context).toBe("neighbors");
    expect((await doTranslate(token, tj as NonNullable<typeof tj>, "Bản AI mới")).status).toBe(200);

    const [after] = await db.select().from(pageStates).where(eq(pageStates.pageId, first.id));
    expect(after?.state?.regions[0]?.translation).toBe("Bản sửa tay");
    expect(after?.aiState?.regions[0]?.translation).toBe("Bản AI mới");
    expect(after?.aiUpdateAvailable).toBe(true);
    expect(after?.version).toBe((before?.version ?? 0) + 2);
    const [ch] = await db.select().from(chapters).where(eq(chapters.id, A.chapterId));
    expect(ch?.status).toBe("review");
  });

  it("a translate result missing a page fails only that page and tags the job with schema", async () => {
    const [, second, third] = await pageRows(A.chapterId);
    if (!second || !third) throw new Error("no pages");
    await inJobTx((tx) => retranslate(tx, A.userId, A.chapterId, [second.id, third.id]));
    const [tj] = await claimJobs(token, { caps: ["chapter.translate"] });
    if (!tj) throw new Error("no translate job");
    // Worker bỏ page AI trả sai định dạng cả khi dịch riêng; page còn lại vẫn lưu.
    const res = await complete(token, tj, {
      type: "chapter.translate",
      pages: [{ page_id: second.id, ai_state: aiState(second.width, second.height, "Đã dịch") }],
    });
    expect(res.status).toBe(200);
    const after = await pageRows(A.chapterId);
    expect(after.find((r) => r.id === second.id)?.status).toBe("ready");
    expect(after.find((r) => r.id === third.id)?.status).toBe("failed");
    const [job] = await db.select().from(jobs).where(eq(jobs.id, tj.id));
    expect(job?.status).toBe("succeeded");
    expect(job?.errorClass).toBe("schema");
    const [kept] = await db.select().from(pageStates).where(eq(pageStates.pageId, third.id));
    expect(kept?.aiState?.regions[0]?.translation).not.toBe("Đã dịch"); // bản AI cũ không bị ghi đè
  });

  it("blocks re-ingest once a page has user edits → 409", async () => {
    const res = await inJobTx((tx) => enqueueIngest(tx, A.userId, A.chapterId)).catch((e: unknown) => e);
    expect((res as { status?: number }).status).toBe(409);
  });
});
