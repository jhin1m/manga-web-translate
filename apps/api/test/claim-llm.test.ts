/**
 * Cấu hình AI theo job: snapshot ref vào payload lúc enqueue, giải mã key lúc claim (chỉ trong response, `no-store`),
 * lỗi cấu hình -> job `failed` lớp `auth`, khoá idempotency / input_rev, và các đường phụ thuộc (xoá provider, 426).
 */
import { chapters, jobs, pages, runtimeFlags, systemSettings } from "@mtl/db";
import { idempotencyKey } from "@mtl/shared";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/env.ts";
import { BREAKER_THRESHOLD } from "../src/jobs/breaker.ts";
import { enqueueOcrRegion, enqueuePrepare, enqueueProofread, enqueueTranslate, inJobTx } from "../src/jobs/enqueue.ts";
import { db, seedUser } from "./helpers.ts";
import { cancelActiveJobs } from "./isolate-queue.ts";
import {
  adminApi,
  chapterAndSeries,
  createProvider,
  insertPage,
  insertPreparedPage,
  jobById,
  modelOf,
  setSlots,
  type TestProvider,
} from "./llm-helpers.ts";
import { type Claimed, claimJobs, failJob, makeRunnable, VERSION, wcall, workerToken } from "./worker-helpers.ts";

const KEY_A = "sk-test-AAAABBBBCCCC1111";
const KEY_A2 = "sk-test-NEWKEYNEWKEY2222";
const KEY_B = "sk-test-DDDDEEEEFFFF3333";
const MINI = { model_id: "gpt-4.1-mini", price_in: 0.4, price_out: 1.6, vision: true };
const BIG = { model_id: "gpt-4.1", price_in: 2, price_out: 8, vision: true };

type Seed = Awaited<ReturnType<typeof seedUser>>;
let S: Seed;
let token: string;
let A: TestProvider;
let B: TestProvider;

beforeEach(async () => {
  await cancelActiveJobs();
  await db
    .update(systemSettings)
    .set({ pipeline: {}, ocrModelId: null, translateModelId: null, proofreadModelId: null });
  S = await seedUser("claim-llm");
  token = (await workerToken("mac", "claim-llm")).token;
  A = await createProvider(KEY_A, [MINI, BIG]);
  B = await createProvider(KEY_B, [MINI]);
});

const enqueueTranslateJob = async () => {
  const page = await insertPreparedPage(S);
  return (await inJobTx((tx) => enqueueTranslate(tx, S.userId, S.chapterId, [page.id], "neighbors"))).job;
};

const leaks = (value: unknown, ...secrets: string[]) => {
  const text = JSON.stringify(value);
  return secrets.filter((s) => text.includes(s));
};

describe("translate slot", () => {
  it("snapshots {provider_id, model}; claim returns the decrypted key with no-store; the job row has no key", async () => {
    await setSlots({ translate: modelOf(A, "gpt-4.1-mini") });
    const job = await enqueueTranslateJob();
    expect(job.payload).toMatchObject({ llm: { translate: { provider_id: A.id, model: "gpt-4.1-mini" } } });
    expect(job.payload).not.toHaveProperty("llm.ocr");

    const res = await wcall(token, "/claim", {
      worker_id: "t",
      capabilities: ["chapter.translate"],
      max: 1,
      pipeline_version: VERSION,
      dispatch_id: null,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { jobs: claimed } = (await res.json()) as { jobs: { id: string; payload: unknown; llm: unknown }[] };
    expect(claimed[0]?.id).toBe(job.id);
    expect(claimed[0]?.llm).toEqual({
      translate: {
        type: "openai",
        model: "gpt-4.1-mini",
        api_key: KEY_A,
        base_url: null,
        structured_output: "json_schema",
        reasoning: false,
      },
    });
    expect(leaks(claimed[0]?.payload, KEY_A)).toEqual([]);
    expect(leaks(await jobById(job.id), KEY_A)).toEqual([]);
  });

  it("a key changed between enqueue and claim reaches the next claim", async () => {
    await setSlots({ translate: modelOf(A, "gpt-4.1-mini") });
    await enqueueTranslateJob();
    const res = await adminApi(`/providers/${A.id}`, "PATCH", { api_key: KEY_A2 });
    expect(res.status, await res.clone().text()).toBe(200);
    const [claimed] = await claimJobs(token, { caps: ["chapter.translate"] });
    expect((claimed as unknown as { llm: { translate: { api_key: string } } }).llm.translate.api_key).toBe(KEY_A2);
  });

  it("an unreadable key fails the job as auth with a clear message, never leaking the key or blob", async () => {
    await setSlots({ translate: modelOf(A, "gpt-4.1-mini") });
    const job = await enqueueTranslateJob();
    const translatePages = (job.payload as { page_ids: string[] }).page_ids;
    const other = await (async () => {
      const page = await insertPage(S, { ord: 1 });
      const { ch, s } = await chapterAndSeries(S);
      return (await inJobTx((tx) => enqueuePrepare(tx, page, s, ch))).job;
    })();
    const logs = vi.spyOn(console, "warn");
    env.SECRETS_KEY = "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg=";

    // translate đứng trước prepare cùng lô claim: job hỏng bị fail, job còn lại vẫn trả về.
    const claimed = await claimJobs(token, { caps: ["chapter.translate", "page.prepare"], max: 2 });
    expect(claimed.map((j) => j.id)).toEqual([other.id]);
    const row = await jobById(job.id);
    expect(row.status).toBe("failed");
    expect(row.errorClass).toBe("auth");
    expect(row.error).toContain("Cấu hình AI lỗi");
    expect(row.error).toContain("không giải mã được key");
    expect(row.error).toContain("nhập lại key");
    const [dbProvider] = await db.query.aiProviders.findMany({ where: (p, { eq: e }) => e(p.id, A.id) });
    expect(leaks([row, logs.mock.calls], KEY_A, dbProvider?.apiKeyEnc ?? "never")).toEqual([]);
    logs.mockRestore();
    // Trang của job hỏng không kẹt ở "đang dịch".
    const stuck = await db
      .select()
      .from(pages)
      .where(and(inArray(pages.id, translatePages), eq(pages.status, "translating")));
    expect(stuck).toEqual([]);
  });
});

describe("ocr slot", () => {
  it("prepare carries llm.ocr only when the OCR engine is llm", async () => {
    await setSlots({ ocr: modelOf(A, "gpt-4.1-mini"), translate: modelOf(A, "gpt-4.1") });
    const { ch, s } = await chapterAndSeries(S);
    const llmPage = await insertPage(S);
    const llmJob = (await inJobTx((tx) => enqueuePrepare(tx, llmPage, s, ch))).job;
    expect(llmJob.payload).toMatchObject({ llm: { ocr: { provider_id: A.id, model: "gpt-4.1-mini" } } });
    expect(llmJob.payload).not.toHaveProperty("llm.translate");

    const res = await adminApi("/settings");
    const { pipeline } = (await res.json()) as { pipeline: Record<string, unknown> & { ocr_engines: object } };
    const put = await adminApi("/settings/pipeline", "PUT", {
      pipeline: { ...pipeline, ocr_engines: { ...pipeline.ocr_engines, ko: "paddle_ocr" } },
    });
    expect(put.status, await put.clone().text()).toBe(200);
    const localPage = await insertPage(S, { ord: 1 });
    const localJob = (await inJobTx((tx) => enqueuePrepare(tx, localPage, s, ch))).job;
    expect(localJob.payload).not.toHaveProperty("llm");
  });

  it("ocr_region carries ocr + translate for the llm engine, translate only for local OCR", async () => {
    await setSlots({ ocr: modelOf(A, "gpt-4.1-mini"), translate: modelOf(B, "gpt-4.1-mini") });
    const page = await insertPage(S);
    const first = await inJobTx((tx) =>
      enqueueOcrRegion(tx, S.userId, { type: "page.ocr_region", page_id: page.id, bbox: [1, 2, 30, 40] }),
    );
    expect(first.job.payload).toMatchObject({
      llm: {
        ocr: { provider_id: A.id, model: "gpt-4.1-mini" },
        translate: { provider_id: B.id, model: "gpt-4.1-mini" },
      },
    });

    const { pipeline } = (await (await adminApi("/settings")).json()) as {
      pipeline: Record<string, unknown> & { ocr_engines: object };
    };
    await adminApi("/settings/pipeline", "PUT", {
      pipeline: { ...pipeline, ocr_engines: { ...pipeline.ocr_engines, ko: "paddle_ocr" } },
    });
    const local = await inJobTx((tx) =>
      enqueueOcrRegion(tx, S.userId, { type: "page.ocr_region", page_id: page.id, bbox: [5, 6, 30, 40] }),
    );
    expect(local.job.payload).toMatchObject({ llm: { translate: { provider_id: B.id } } });
    expect(local.job.payload).not.toHaveProperty("llm.ocr");
  });
});

describe("idempotency", () => {
  it("changing the slot model changes the idempotency key but not the input_rev", async () => {
    await setSlots({ translate: modelOf(A, "gpt-4.1-mini") });
    const page = await insertPreparedPage(S);
    const enqueue = () =>
      inJobTx((tx) => enqueueTranslate(tx, S.userId, S.chapterId, [page.id], "neighbors")).then((r) => r.job);
    const first = await enqueue();
    expect((await enqueue()).id).toBe(first.id);
    await setSlots({ translate: modelOf(A, "gpt-4.1") });
    const second = await enqueue();
    expect(second.id).not.toBe(first.id);
    expect(second.inputRev).toBe(first.inputRev);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });
});

describe("proofread", () => {
  const readyChapter = async () => {
    await insertPage(S, { status: "ready" });
    await db.update(chapters).set({ status: "review" }).where(eq(chapters.id, S.chapterId));
  };

  it("without a slot keeps model_tier + the {tier} key, including a premium tier stored by the old pipeline", async () => {
    await readyChapter();
    await db
      .insert(systemSettings)
      .values({ id: 1, pipeline: { proofread_tier: "premium" } as never })
      .onConflictDoUpdate({ target: systemSettings.id, set: { pipeline: { proofread_tier: "premium" } as never } });
    const { job } = await inJobTx((tx) => enqueueProofread(tx, S.userId, S.chapterId));
    expect(job.payload).toMatchObject({ model_tier: "premium" });
    expect(job.payload).not.toHaveProperty("llm");
    expect(job.idempotencyKey).toBe(
      idempotencyKey("chapter.proofread", S.chapterId, job.inputRev, { tier: "premium" }),
    );
  });

  it("saving the pipeline in the admin UI keeps the stored legacy tier", async () => {
    await db
      .insert(systemSettings)
      .values({ id: 1, pipeline: { proofread_tier: "premium" } as never })
      .onConflictDoUpdate({ target: systemSettings.id, set: { pipeline: { proofread_tier: "premium" } as never } });
    const { pipeline } = (await (await adminApi("/settings")).json()) as { pipeline: Record<string, unknown> };
    expect(pipeline).not.toHaveProperty("proofread_tier");
    const put = await adminApi("/settings/pipeline", "PUT", { pipeline: { ...pipeline, detection_threshold: 0.4 } });
    expect(put.status, await put.clone().text()).toBe(200);
    const [row] = await db.select().from(systemSettings);
    expect(row?.pipeline).toMatchObject({ proofread_tier: "premium", detection_threshold: 0.4 });
  });

  it("with a slot carries llm.proofread, no model_tier, and a {llm} key", async () => {
    await readyChapter();
    await setSlots({ proofread: modelOf(A, "gpt-4.1") });
    const { job } = await inJobTx((tx) => enqueueProofread(tx, S.userId, S.chapterId));
    expect(job.payload).toMatchObject({ llm: { proofread: { provider_id: A.id, model: "gpt-4.1" } } });
    expect(job.payload).not.toHaveProperty("model_tier");
    expect(job.idempotencyKey).toBe(
      idempotencyKey("chapter.proofread", S.chapterId, job.inputRev, {
        llm: { proofread: { provider_id: A.id, model: "gpt-4.1" } },
      }),
    );
    const [claimed] = await claimJobs(token, { caps: ["chapter.proofread"] });
    expect(claimed?.id).toBe(job.id);
    expect((claimed as unknown as { llm: { proofread: { model: string } } }).llm.proofread.model).toBe("gpt-4.1");
  });
});

describe("providers referenced by active jobs", () => {
  it("deleting a provider is blocked with in_use_by_jobs while a job still references it", async () => {
    await setSlots({ translate: modelOf(A, "gpt-4.1-mini") });
    await enqueueTranslateJob();
    await setSlots({});
    const res = await adminApi(`/providers/${A.id}`, "DELETE");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "in_use_by_jobs", jobs: 1 });
  });
});

describe("breaker per provider", () => {
  const clearBreaker = () => db.delete(runtimeFlags).where(like(runtimeFlags.key, "llm\\_%"));
  beforeEach(clearBreaker);
  afterAll(clearBreaker);

  /** 1 page, 1 job ocr_region mỗi lần (bbox khác nhau) với slot dịch hiện tại. */
  async function regionJob(page: { id: string }, bbox: [number, number, number, number]) {
    const { job } = await inJobTx((tx) =>
      enqueueOcrRegion(tx, S.userId, { type: "page.ocr_region", page_id: page.id, bbox }),
    );
    return job;
  }
  const failProvider = async (id: string) => {
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      await makeRunnable(eq(jobs.userId, S.userId));
      const [j] = await claimJobs(token, { caps: ["page.ocr_region"] });
      expect(j?.id).toBe(id);
      expect((await failJob(token, j as Claimed, "provider")).status).toBe(200);
    }
    await makeRunnable(eq(jobs.userId, S.userId));
  };
  const flags = async () =>
    (await db.select().from(runtimeFlags)).map((r) => r.key).filter((k) => k.startsWith("llm_paused"));

  it("five errors of provider A pause only A: B and env jobs still claim", async () => {
    const page = await insertPage(S);
    await setSlots({ translate: modelOf(A, "gpt-4.1-mini") });
    const ja = await regionJob(page, [1, 1, 20, 20]);
    await setSlots({ translate: modelOf(B, "gpt-4.1-mini") });
    const jb = await regionJob(page, [2, 2, 20, 20]);
    await setSlots({});
    const je = await regionJob(page, [3, 3, 20, 20]);

    await failProvider(ja.id);
    expect(await flags()).toEqual([`llm_paused:${A.id}`]);
    const claimed = await claimJobs(token, { caps: ["page.ocr_region"], max: 3 });
    expect(claimed.map((j) => j.id).sort()).toEqual([jb.id, je.id].sort());
    expect((await jobById(ja.id)).status).toBe("queued");
  });

  it("five env errors pause env jobs only: a provider job still claims", async () => {
    const page = await insertPage(S);
    const je = await regionJob(page, [3, 3, 20, 20]);
    await setSlots({ translate: modelOf(B, "gpt-4.1-mini") });
    const jb = await regionJob(page, [2, 2, 20, 20]);

    await failProvider(je.id);
    expect(await flags()).toEqual(["llm_paused"]);
    const claimed = await claimJobs(token, { caps: ["page.ocr_region"], max: 3 });
    expect(claimed.map((j) => j.id)).toEqual([jb.id]);
  });
});

describe("worker version", () => {
  it("a worker older than 0.10.0 gets 426", async () => {
    const res = await wcall(token, "/claim", {
      worker_id: "t",
      capabilities: ["chapter.translate"],
      max: 1,
      pipeline_version: "0.9.0",
      dispatch_id: null,
    });
    expect(res.status).toBe(426);
  });
});
