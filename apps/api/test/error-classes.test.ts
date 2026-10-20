/**
 * Phân loại lỗi (red team #7): 429/provider không tính attempt + theo Retry-After, circuit breaker, giữ artifact
 * trước LLM; schema/internal tính attempt; invalid_input failed ngay; chương không kẹt `processing`.
 * Usage được clamp ở server.
 */
import { chapters, jobs, pages, runtimeFlags, usageLedger } from "@mtl/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_OUTPUT_TOKENS_PER_CALL } from "../src/billing/prices.ts";
import { BREAKER_THRESHOLD } from "../src/jobs/breaker.ts";
import { enqueueIngest, inJobTx } from "../src/jobs/enqueue.ts";
import { MAX_PROVIDER_RETRIES } from "../src/jobs/errors.ts";
import { db, seedWorkspace } from "./helpers.ts";
import {
  addSources,
  type Claimed,
  claimJobs,
  doIngest,
  doPrepare,
  doTranslate,
  failJob,
  fence,
  jobRow,
  makeRunnable,
  OCR,
  putPng,
  usage,
  wcall,
  workerToken,
} from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedWorkspace>>;

const clearBreaker = () => db.delete(runtimeFlags).where(sql`${runtimeFlags.key} in ('llm_paused', 'llm_errors')`);

async function chapterWithPages(label: string, n: number) {
  const S = await seedWorkspace(label);
  const token = (await workerToken(S.workspaceId)).token;
  await addSources(S.workspaceId, S.chapterId, n);
  await inJobTx((tx) => enqueueIngest(tx, S.workspaceId, S.chapterId));
  const [ij] = await claimJobs(token, { caps: ["chapter.ingest"] });
  expect((await doIngest(token, ij as Claimed)).status).toBe(200);
  return { S, token };
}

async function claimOne(token: string, caps = ["page.prepare"]): Promise<Claimed> {
  const [j] = await claimJobs(token, { caps });
  if (!j) throw new Error(`nothing to claim for ${caps}`);
  return j;
}

beforeAll(clearBreaker);
afterAll(clearBreaker);

describe("provider / rate_limited", () => {
  let S: Seed;
  let token: string;

  it("429: attempts not consumed, requeued per Retry-After, breaker trips after 5", async () => {
    ({ S, token } = await chapterWithPages("e429", 2));
    const j = await claimOne(token);
    expect((await failJob(token, j, "rate_limited", { retry_after_s: 90 })).status).toBe(200);
    const row = await jobRow(j.id);
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(0);
    expect(row.providerRetries).toBe(1);
    expect(row.runAfter.getTime() - Date.now()).toBeGreaterThan(80_000);

    // Thêm lỗi tới ngưỡng breaker (mỗi lần lấy job đã đến hạn).
    for (let i = 1; i < BREAKER_THRESHOLD; i++) {
      await makeRunnable(eq(jobs.workspaceId, S.workspaceId));
      const k = await claimOne(token);
      expect((await failJob(token, k, "rate_limited")).status).toBe(200);
    }
    await makeRunnable(eq(jobs.workspaceId, S.workspaceId));
    const [paused] = await db.select().from(runtimeFlags).where(eq(runtimeFlags.key, "llm_paused"));
    expect(paused?.until?.getTime()).toBeGreaterThan(Date.now());
    // Đang pause: loại job cần LLM không được claim.
    expect(await claimJobs(token, { caps: ["page.prepare"], max: 4 })).toEqual([]);
    const rows = await db.select().from(jobs).where(eq(jobs.workspaceId, S.workspaceId));
    expect(rows.filter((r) => r.type === "page.prepare").every((r) => r.attempts === 0)).toBe(true);
    await clearBreaker();
  });

  it("gives up after MAX_PROVIDER_RETRIES and the chapter ends partial_failed, not stuck", async () => {
    const [victim] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.workspaceId, S.workspaceId), eq(jobs.type, "page.prepare"), sql`${jobs.providerRetries} > 0`));
    await db
      .update(jobs)
      .set({ providerRetries: MAX_PROVIDER_RETRIES })
      .where(eq(jobs.id, victim?.id as string));
    await makeRunnable(eq(jobs.workspaceId, S.workspaceId));
    // Claim cả 2 page.prepare; job đã hết lượt provider → failed, job còn lại thành công.
    const claimed = await claimJobs(token, { caps: ["page.prepare"], max: 2 });
    expect(claimed).toHaveLength(2);
    for (const c of claimed) {
      if (c.id === victim?.id) expect((await failJob(token, c, "provider")).status).toBe(200);
      else expect((await doPrepare(token, c)).status).toBe(200);
    }
    expect((await jobRow(victim?.id as string)).status).toBe("failed");

    // Giai đoạn 1 xong (1 prepared + 1 failed) → dịch riêng page đã prepare.
    const t = await claimOne(token, ["chapter.translate"]);
    expect(t.payload.context).toBe("neighbors");
    expect((await doTranslate(token, t)).status).toBe(200);
    const [ch] = await db.select().from(chapters).where(eq(chapters.id, S.chapterId));
    expect(ch?.status).toBe("partial_failed");
  });
});

describe("partial artifacts", () => {
  it("fail(provider) with partial keeps clean/mask → next claim gets inputs.partial", async () => {
    const { token } = await chapterWithPages("epart", 1);
    const j = await claimOne(token);
    await putPng(j.outputs.clean?.put ?? "");
    await putPng(j.outputs.mask?.put ?? "");
    const rev = j.outputs.clean?.rev ?? -1;
    const partial = { clean_rev: rev, mask_rev: rev, regions: OCR.regions };
    expect((await failJob(token, j, "provider", { partial, usage: usage(1) })).status).toBe(200);
    const [pg] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, j.payload.page_id as string));
    expect(pg?.preparePartial?.clean_rev).toBe(rev);
    // Token đã tiêu của attempt lỗi vẫn vào ledger.
    expect((await db.select().from(usageLedger).where(eq(usageLedger.jobId, j.id))).length).toBeGreaterThan(0);

    await makeRunnable(eq(jobs.id, j.id));
    const again = await claimOne(token);
    expect(again.id).toBe(j.id);
    const inputs = again.inputs as { partial: { regions: unknown[]; clean: string } | null };
    expect(inputs.partial?.regions).toHaveLength(OCR.regions.length);
    expect(again.outputs.clean?.rev).toBeGreaterThan(rev);
    expect((await doPrepare(token, again)).status).toBe(200);
    const [after] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, j.payload.page_id as string));
    expect(after?.preparePartial).toBeNull();
  });
});

describe("schema / internal / invalid_input", () => {
  it("schema errors consume attempts up to max_attempts", async () => {
    const { token } = await chapterWithPages("eschema", 1);
    let id = "";
    for (let i = 1; i <= 3; i++) {
      const j = await claimOne(token);
      id = j.id;
      expect((await jobRow(j.id)).attempts).toBe(i);
      expect((await failJob(token, j, "schema")).status).toBe(200);
      if (i < 3) {
        const row = await jobRow(j.id);
        expect(row.status).toBe("queued");
        expect(row.runAfter.getTime()).toBeGreaterThan(Date.now());
        await makeRunnable(eq(jobs.id, j.id));
      }
    }
    expect((await jobRow(id)).status).toBe("failed");
  });

  it("invalid_input fails immediately and marks the page failed", async () => {
    const { S, token } = await chapterWithPages("einv", 1);
    const j = await claimOne(token);
    expect((await failJob(token, j, "invalid_input")).status).toBe(200);
    expect((await jobRow(j.id)).status).toBe("failed");
    const [pg] = await db.select().from(pages).where(eq(pages.chapterId, S.chapterId));
    expect(pg?.status).toBe("failed");
    const [ch] = await db.select().from(chapters).where(eq(chapters.id, S.chapterId));
    expect(ch?.status).toBe("partial_failed");
  });
});

describe("usage clamp", () => {
  it("clamps llm_out per call and gpu_s to wall time since claim; same seq is not double-counted", async () => {
    const { token } = await chapterWithPages("eclamp", 1);
    const j = await claimOne(token);
    const hb = (seq: number, over = {}) =>
      wcall(token, `/jobs/${j.id}/heartbeat`, { ...fence(j), progress: 0.5, stage: "ocr", usage: usage(seq, over) });
    expect((await hb(1, { llm_out: 10_000_000, calls: 1, gpu_s: 99_999 })).status).toBe(200);
    expect((await hb(1, { llm_out: 10_000_000, calls: 1 })).status).toBe(200);
    const rows = await db.select().from(usageLedger).where(eq(usageLedger.jobId, j.id));
    const out = rows.filter((r) => r.kind === "llm_tokens_out");
    expect(out).toHaveLength(1);
    expect(out[0]?.quantity).toBe(MAX_OUTPUT_TOKENS_PER_CALL);
    const gpu = rows.find((r) => r.kind === "gpu_seconds");
    expect(gpu?.quantity ?? 0).toBeLessThan(60);
    // Worker Mac: GPU giá 0; token LLM tính theo bảng giá server.
    expect(gpu?.costUsd ?? 0).toBe(0);
    expect(out[0]?.costUsd).toBeCloseTo((MAX_OUTPUT_TOKENS_PER_CALL * 2.5) / 1e6, 9);
  });
});
