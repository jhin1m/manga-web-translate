/**
 * Khoá hình dạng claim + khoá idempotency của 4 loại job LLM khi chưa có provider trong DB (chạy bằng env worker):
 * key object job, payload, `idempotency_key`. Job không slot phải ra đúng như trước khi có cấu hình AI theo job.
 */
import { createHash } from "node:crypto";
import { chapters, pageStates } from "@mtl/db";
import {
  idempotencyKey,
  prepareInputRev,
  prepareOptions,
  resolvePipelineSettings,
  translateInputRev,
} from "@mtl/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "../src/env.ts";
import { enqueueOcrRegion, enqueuePrepare, enqueueProofread, enqueueTranslate, inJobTx } from "../src/jobs/enqueue.ts";
import { db, seedUser } from "./helpers.ts";
import { cancelActiveJobs } from "./isolate-queue.ts";
import { chapterAndSeries, insertPage as insertPageFor, jobById } from "./llm-helpers.ts";
import { claimJobs, OCR, VERSION, wcall, workerToken } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const CLAIM_KEYS = ["attempt", "id", "inputs", "lease_expires_at", "lease_token", "outputs", "payload", "type"];

let S: Seed;
let token: string;

beforeEach(async () => {
  await cancelActiveJobs();
  S = await seedUser("claim-payload");
  token = (await workerToken("mac", "claim-payload")).token;
});

const insertPage = (over: Parameters<typeof insertPageFor>[1] = {}) => insertPageFor(S, over);
const ctx = () => chapterAndSeries(S);
const jobOf = jobById;

describe("claim shape + idempotency key without ai providers", () => {
  it("page.prepare", async () => {
    const page = await insertPage();
    const { ch, s } = await ctx();
    const { job } = await inJobTx((tx) => enqueuePrepare(tx, page, s, ch));
    const [claimed] = await claimJobs(token, { caps: ["page.prepare"] });
    expect(claimed?.id).toBe(job.id);
    expect(Object.keys(claimed ?? {}).sort()).toEqual(CLAIM_KEYS);
    expect(claimed?.payload).not.toHaveProperty("llm");

    const options = prepareOptions(resolvePipelineSettings({}), s.sourceLang);
    const rev = prepareInputRev(page.originalSha256, s.settingsRev, env.PIPELINE_VERSION, options);
    expect((await jobOf(job.id)).idempotencyKey).toBe(idempotencyKey("page.prepare", page.id, rev));
  });

  it("chapter.translate", async () => {
    const page = await insertPage({
      ocrResult: OCR,
      cleanRev: 1,
      maskRev: 1,
      prepareInputRev: "ab".repeat(32),
      status: "prepared",
    });
    const { s } = await ctx();
    const { job } = await inJobTx((tx) => enqueueTranslate(tx, S.userId, S.chapterId, [page.id], "neighbors"));
    const [claimed] = await claimJobs(token, { caps: ["chapter.translate"] });
    expect(claimed?.id).toBe(job.id);
    expect(Object.keys(claimed ?? {}).sort()).toEqual(CLAIM_KEYS);
    expect(claimed?.payload).not.toHaveProperty("llm");

    const rev = translateInputRev(
      [{ pageId: page.id, prepareInputRev: "ab".repeat(32) }],
      s.glossaryRev,
      s.settingsRev,
      env.PIPELINE_VERSION,
    );
    expect((await jobOf(job.id)).idempotencyKey).toBe(
      idempotencyKey("chapter.translate", S.chapterId, rev, { context: "neighbors" }),
    );
  });

  it("page.ocr_region", async () => {
    const page = await insertPage();
    const { job } = await inJobTx((tx) =>
      enqueueOcrRegion(tx, S.userId, { type: "page.ocr_region", page_id: page.id, bbox: [10, 20, 200, 80] }),
    );
    const [claimed] = await claimJobs(token, { caps: ["page.ocr_region"] });
    expect(claimed?.id).toBe(job.id);
    expect(Object.keys(claimed ?? {}).sort()).toEqual(CLAIM_KEYS);
    expect(claimed?.payload).not.toHaveProperty("llm");

    // Thứ tự khoá như lúc enqueue (JSON.stringify của input_rev phụ thuộc thứ tự, jsonb trong DB thì không giữ).
    const opts = {
      bbox: [10, 20, 200, 80],
      source_lang: "ko",
      target_lang: "vi",
      ocr_engine: "llm",
      reading_order: "ltr",
    };
    const rev = sha(JSON.stringify([opts, env.PIPELINE_VERSION]));
    expect((await jobOf(job.id)).idempotencyKey).toBe(idempotencyKey("page.ocr_region", page.id, rev, opts));
  });

  it("chapter.proofread keeps the {tier} key and model_tier from the pipeline", async () => {
    const page = await insertPage({ status: "ready" });
    await db.update(chapters).set({ status: "review" }).where(eq(chapters.id, S.chapterId));
    const { s } = await ctx();
    const { job } = await inJobTx((tx) => enqueueProofread(tx, S.userId, S.chapterId));
    const [claimed] = await claimJobs(token, { caps: ["chapter.proofread"] });
    expect(claimed?.id).toBe(job.id);
    expect(Object.keys(claimed ?? {}).sort()).toEqual(CLAIM_KEYS);
    expect(claimed?.payload).toMatchObject({ model_tier: "standard" });
    expect(claimed?.payload).not.toHaveProperty("llm");

    const [state] = await db.select().from(pageStates).where(eq(pageStates.pageId, page.id));
    const rev = sha([`${page.id}:${state?.version}`, s.glossaryRev, s.settingsRev, env.PIPELINE_VERSION].join("|"));
    expect((await jobOf(job.id)).idempotencyKey).toBe(
      idempotencyKey("chapter.proofread", S.chapterId, rev, { tier: "standard" }),
    );
  });
});

describe("api shape sanity", () => {
  it("claim response carries no llm for a plain job", async () => {
    const page = await insertPage();
    const { ch, s } = await ctx();
    await inJobTx((tx) => enqueuePrepare(tx, page, s, ch));
    const res = await wcall(token, "/claim", {
      worker_id: "t",
      capabilities: ["page.prepare"],
      max: 1,
      pipeline_version: VERSION,
      dispatch_id: null,
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain('"llm":');
  });
});
