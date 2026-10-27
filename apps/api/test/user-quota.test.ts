/**
 * Hạn mức chi phí ngày mỗi người dùng (USER_DAILY_USD, mọi chi phí — kể cả chỉ GPU): endpoint LLM 402, job LLM chờ /
 * đang chạy → failed `quota_exceeded` (chương không kẹt), Modal không nhận job nào của người vượt, Mac vẫn chạy job
 * không-LLM, người khác không bị ảnh hưởng; ngưỡng 0 chặn cả khi chưa tiêu gì.
 */
import { chapters, jobs, pages, usageLedger } from "@mtl/db";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "../src/env.ts";
import { enqueueIngest, inJobTx, insertJob } from "../src/jobs/enqueue.ts";
import { failOverQuotaQueued } from "../src/jobs/queue.ts";
import { call, db, seedUser } from "./helpers.ts";
import { cancelActiveJobs } from "./isolate-queue.ts";
import {
  addSources,
  type Claimed,
  claimJobs,
  doIngest,
  fence,
  jobRow,
  usage,
  wcall,
  workerToken,
} from "./worker-helpers.ts";

/** Chi phí GPU giả của người dùng hôm nay (không gắn job). */
const spend = (userId: string, usd: number) =>
  db.insert(usageLedger).values({ userId, kind: "gpu_seconds", quantity: 1, unitCostUsd: usd, costUsd: usd });

/** Người dùng có chương đã ingest (Mac) → page.prepare (OCR LLM mặc định) đang chờ. */
async function ingested(label: string, n = 1) {
  const S = await seedUser(label);
  const mac = (await workerToken("mac")).token;
  await addSources(S.userId, S.chapterId, n);
  await inJobTx((tx) => enqueueIngest(tx, S.userId, S.chapterId));
  const [ij] = await claimJobs(mac, { caps: ["chapter.ingest"] });
  expect((await doIngest(mac, ij as Claimed)).status).toBe(200);
  return { S, mac };
}

const prepareJobs = (chapterId: string) =>
  db
    .select()
    .from(jobs)
    .where(and(eq(jobs.chapterId, chapterId), eq(jobs.type, "page.prepare")));

const exportJob = (S: { userId: string; chapterId: string }) =>
  inJobTx((tx) =>
    insertJob(tx, {
      userId: S.userId,
      payload: {
        type: "chapter.export",
        chapter_id: S.chapterId,
        format: "cbz",
        layout: "pages",
        quality: 90,
        include_untranslated: true,
      },
      key: { inputRev: "r", idempotencyKey: `quota-export-${S.chapterId}` },
      chapterId: S.chapterId,
    }),
  );

beforeEach(cancelActiveJobs);
afterEach(() => {
  env.USER_DAILY_USD = undefined;
});

describe("user daily quota — API", () => {
  it("/api/me reports the quota; LLM endpoints answer 402 once over (GPU cost counts); others unaffected", async () => {
    env.USER_DAILY_USD = 1;
    const { S } = await ingested("quota-api");
    const B = await seedUser("quota-api-b");
    await spend(S.userId, 1.5);

    const me = (await (await call("/api/me", { cookie: S.cookie })).json()) as { quota: Record<string, unknown> };
    expect(me.quota).toMatchObject({ spent_usd: 1.5, limit_usd: 1 });
    expect(String(me.quota.resets_at)).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);

    const ch = S.chapterId;
    for (const path of [`/translate`, `/retry-failed`, `/translate-prepared`, `/proofread`]) {
      const res = await call(`/api/chapters/${ch}${path}`, { method: "POST", cookie: S.cookie, body: {} });
      expect(res.status, path).toBe(402);
      expect(await res.json()).toMatchObject({ error: "quota_exceeded", spent_usd: 1.5, limit_usd: 1 });
    }
    const [page] = await db.select().from(pages).where(eq(pages.chapterId, ch));
    const ocr = await call(`/api/pages/${page?.id}/ocr-region`, {
      method: "POST",
      cookie: S.cookie,
      body: { bbox: [0, 0, 10, 10] },
    });
    expect(ocr.status).toBe(402);

    const meB = (await (await call("/api/me", { cookie: B.cookie })).json()) as { quota: Record<string, unknown> };
    expect(meB.quota).toMatchObject({ spent_usd: 0, limit_usd: 1 });
    const other = await call(`/api/chapters/${B.chapterId}/proofread`, { method: "POST", cookie: B.cookie, body: {} });
    expect(other.status).not.toBe(402);
  });

  it("limit 0 blocks LLM jobs even with an empty ledger; no limit → never blocked", async () => {
    const S = await seedUser("quota-zero");
    env.USER_DAILY_USD = 0;
    const res = await call(`/api/chapters/${S.chapterId}/retry-failed`, { method: "POST", cookie: S.cookie, body: {} });
    expect(res.status).toBe(402);
    env.USER_DAILY_USD = undefined;
    const me = (await (await call("/api/me", { cookie: S.cookie })).json()) as { quota: Record<string, unknown> };
    expect(me.quota).toMatchObject({ limit_usd: null });
    const again = await call(`/api/chapters/${S.chapterId}/retry-failed`, {
      method: "POST",
      cookie: S.cookie,
      body: {},
    });
    expect(again.status).toBe(202);
  });
});

describe("user daily quota — queue", () => {
  it("claim fails queued LLM jobs of the over-quota user (chapter not stuck); other users keep claiming", async () => {
    env.USER_DAILY_USD = 1;
    const A = await ingested("quota-qa");
    const B = await ingested("quota-qb");
    await spend(A.S.userId, 2); // chỉ do GPU

    const modal = (await workerToken("modal", "modal-quota")).token;
    const got = await claimJobs(modal, { caps: ["page.prepare"], max: 8 });
    const bJobs = (await prepareJobs(B.S.chapterId)).map((j) => j.id);
    expect(got.map((j) => j.id)).toEqual(bJobs);

    const [aJob] = await prepareJobs(A.S.chapterId);
    expect(aJob).toMatchObject({ status: "failed", errorClass: "internal" });
    expect(aJob?.error).toMatch(/^quota_exceeded/);
    const [ch] = await db.select().from(chapters).where(eq(chapters.id, A.S.chapterId));
    expect(ch?.status).not.toBe("processing");
    const [pg] = await db.select().from(pages).where(eq(pages.chapterId, A.S.chapterId));
    expect(pg?.status).toBe("failed");
  });

  it("non-LLM jobs of an over-quota user run on Mac only (Modal never takes their jobs)", async () => {
    env.USER_DAILY_USD = 1;
    const { S, mac } = await ingested("quota-nonllm");
    await cancelActiveJobs();
    await spend(S.userId, 5);
    const { job } = await exportJob(S);
    const modal = (await workerToken("modal", "modal-quota-2")).token;
    expect(await claimJobs(modal, { caps: ["chapter.export"], max: 8 })).toEqual([]);
    const [got] = await claimJobs(mac, { caps: ["chapter.export"], max: 8 });
    expect(got?.id).toBe(job.id);
  });

  it("heartbeat stops a running LLM job once its user goes over the quota", async () => {
    env.USER_DAILY_USD = 1;
    const { S, mac } = await ingested("quota-hb");
    const [j] = (await claimJobs(mac, { caps: ["page.prepare"] })) as Claimed[];
    if (!j) throw new Error("no job");
    await spend(S.userId, 0.99);
    const ok = await wcall(mac, `/jobs/${j.id}/heartbeat`, { ...fence(j), progress: 0.2, stage: null, usage: null });
    expect(((await ok.json()) as { stop: string | null }).stop).toBeNull();
    // Nhịp này mang chi phí LLM đẩy user qua ngưỡng → dừng ngay (usage vẫn được ghi).
    const hb = await wcall(mac, `/jobs/${j.id}/heartbeat`, {
      ...fence(j),
      progress: 0.5,
      stage: null,
      usage: usage(1, { llm_in: 1_000_000, llm_out: 100_000, calls: 1 }),
    });
    expect(hb.status).toBe(200);
    expect(((await hb.json()) as { stop: string }).stop).toBe("cancel");
    const row = await jobRow(j.id);
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/^quota_exceeded/);
    expect((await db.select().from(usageLedger).where(eq(usageLedger.jobId, j.id))).length).toBeGreaterThan(0);
    // Worker cũ báo xong → 409 (lease đã kết thúc).
    expect(
      (await wcall(mac, `/jobs/${j.id}/heartbeat`, { ...fence(j), progress: 1, stage: null, usage: null })).status,
    ).toBe(409);
  });

  it("runner fails waiting LLM jobs (Modal-only); a follow-up job created on worker complete does not error", async () => {
    env.USER_DAILY_USD = 1;
    const S = await seedUser("quota-runner");
    const mac = (await workerToken("mac")).token;
    await spend(S.userId, 3);
    // Ingest (không-LLM) vẫn chạy trên Mac; complete tạo page.prepare nối tiếp mà không lỗi.
    await addSources(S.userId, S.chapterId, 2);
    await inJobTx((tx) => enqueueIngest(tx, S.userId, S.chapterId));
    const [ij] = await claimJobs(mac, { caps: ["chapter.ingest"] });
    expect((await doIngest(mac, ij as Claimed)).status).toBe(200);
    expect((await prepareJobs(S.chapterId)).map((j) => j.status)).toEqual(["queued", "queued"]);

    expect(await inJobTx((tx) => failOverQuotaQueued(tx))).toBe(2);
    expect((await prepareJobs(S.chapterId)).map((j) => j.status)).toEqual(["failed", "failed"]);
    const [ch] = await db.select().from(chapters).where(eq(chapters.id, S.chapterId));
    expect(ch?.status).not.toBe("processing");
  });
});
