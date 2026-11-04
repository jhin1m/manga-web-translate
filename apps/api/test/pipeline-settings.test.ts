/** Cài đặt pipeline chung của hệ thống (admin sửa): lưu, validate, snapshot vào payload job của mọi user, input_rev giữ nguyên với bộ tuỳ chọn OCR LLM cũ (mốc), khác đi khi OCR local. */
import { randomUUID } from "node:crypto";
import { chapters, jobs, pages, runtimeFlags, scoped, series } from "@mtl/db";
import { DEFAULT_PIPELINE_SETTINGS, type PipelineSettings, prepareInputRev } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { env } from "../src/env.ts";
import { enqueueOcrRegion, enqueuePrepare, enqueueReinpaint, inJobTx } from "../src/jobs/enqueue.ts";
import { call, db, seedAdmin, seedUser } from "./helpers.ts";
import { cancelActiveJobs, LLM_OCR_ENGINES } from "./isolate-queue.ts";
import { claimJobs, workerToken } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
let A: Seed;
let adminCookie: string;

/** `seedAdmin` chỉ có hiệu lực trong ca tạo ra nó → mỗi lần gọi admin API phải đăng ký lại email. */
let adminEmail: string;
const asAdmin = () => {
  if (!env.ADMIN_EMAILS.includes(adminEmail)) env.ADMIN_EMAILS.push(adminEmail);
  return adminCookie;
};
const put = (pipeline: unknown) =>
  call("/api/admin/settings/pipeline", { method: "PUT", cookie: asAdmin(), body: { pipeline } });

async function newPage() {
  return scoped(db, A.userId).insert(pages, {
    id: randomUUID(),
    chapterId: A.chapterId,
    ord: 0,
    width: 800,
    height: 1200,
    originalKey: `u/${A.userId}/x.png`,
    originalSha256: "cd".repeat(32),
  });
}

async function prepare(page: typeof pages.$inferSelect) {
  const sdb = scoped(db, A.userId);
  const [s] = await sdb.select(series, eq(series.id, A.seriesId));
  const [ch] = await sdb.select(chapters, eq(chapters.id, A.chapterId));
  await sdb.delete(jobs, eq(jobs.pageId, page.id));
  return (await inJobTx((tx) => enqueuePrepare(tx, page, s as never, ch as never))).job;
}

beforeAll(async () => {
  A = await seedUser("pipeline");
  const admin = await seedAdmin("pipeline-admin");
  adminCookie = admin.cookie;
  adminEmail = admin.email;
});

describe("pipeline settings", () => {
  const read = async () =>
    ((await (await call("/api/admin/settings", { cookie: asAdmin() })).json()) as { pipeline: PipelineSettings })
      .pipeline;

  it("GET /api/admin/settings trả mặc định khi chưa cấu hình; lưu được và đọc lại", async () => {
    expect(await read()).toEqual(DEFAULT_PIPELINE_SETTINGS);
    const custom: PipelineSettings = {
      ...DEFAULT_PIPELINE_SETTINGS,
      inpainter: "lama_manga",
      ocr_engines: { ...DEFAULT_PIPELINE_SETTINGS.ocr_engines, ja: "manga_ocr", ko: "paddle_ocr" },
      mask_dilation: 4,
    };
    const res = await put(custom);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { pipeline: PipelineSettings }).pipeline).toEqual(custom);
    expect(await read()).toEqual(custom);
    await put(DEFAULT_PIPELINE_SETTINGS);
  });

  it("route cũ PUT /api/settings/pipeline đã bỏ; user thường không sửa được cài đặt chung", async () => {
    const old = await call("/api/settings/pipeline", {
      method: "PUT",
      cookie: A.cookie,
      body: { pipeline: DEFAULT_PIPELINE_SETTINGS },
    });
    expect(old.status).toBe(404);
    const denied = await call("/api/admin/settings/pipeline", {
      method: "PUT",
      cookie: A.cookie,
      body: { pipeline: { ...DEFAULT_PIPELINE_SETTINGS, mask_dilation: 9 } },
    });
    expect(denied.status).toBe(403);
    expect(await read()).toEqual(DEFAULT_PIPELINE_SETTINGS);
  });

  it("cài đặt do admin lưu áp cho job của user khác", async () => {
    await put({ ...DEFAULT_PIPELINE_SETTINGS, inpainter: "lama_manga" });
    const B = await seedUser("pipeline-b");
    const sdb = scoped(db, B.userId);
    const page = await sdb.insert(pages, {
      id: randomUUID(),
      chapterId: B.chapterId,
      ord: 0,
      width: 800,
      height: 1200,
      originalKey: `u/${B.userId}/x.png`,
      originalSha256: "ef".repeat(32),
    });
    const [s] = await sdb.select(series, eq(series.id, B.seriesId));
    const [ch] = await sdb.select(chapters, eq(chapters.id, B.chapterId));
    const { job } = await inJobTx((tx) => enqueuePrepare(tx, page, s as never, ch as never));
    expect(job.payload).toMatchObject({ pipeline: { inpainter: "lama_manga" } });
    await put(DEFAULT_PIPELINE_SETTINGS);
  });

  it("từ chối engine không đọc được ngôn ngữ và số ngoài khoảng", async () => {
    const bad = (patch: Partial<PipelineSettings>) => put({ ...DEFAULT_PIPELINE_SETTINGS, ...patch });
    expect((await bad({ ocr_engines: { ...DEFAULT_PIPELINE_SETTINGS.ocr_engines, ko: "manga_ocr" } })).status).toBe(
      400,
    );
    expect((await bad({ detection_threshold: 1.5 })).status).toBe(400);
    expect((await bad({ inpaint_size: 100 })).status).toBe(400);
  });

  it("mặc định: OCR local, không mang model OCR; input_rev khác trang OCR bằng LLM", async () => {
    await put(DEFAULT_PIPELINE_SETTINGS);
    await scoped(db, A.userId).update(series, eq(series.id, A.seriesId), { sourceLang: "ko" });
    const page = await newPage();
    const job = await prepare(page);
    expect(job.payload).toMatchObject({ pipeline: { detector: "rtdetr_v2_comic", ocr_engine: "paddle_ocr" } });
    expect(job.payload).not.toHaveProperty("llm");
    const [s] = await scoped(db, A.userId).select(series, eq(series.id, A.seriesId));
    const legacy = prepareInputRev(page.originalSha256, s?.settingsRev ?? 0, env.PIPELINE_VERSION);
    expect(job.inputRev).not.toBe(legacy);
  });

  it("OCR LLM với các tuỳ chọn còn lại mặc định: input_rev y như trước khi có cài đặt", async () => {
    await put({ ...DEFAULT_PIPELINE_SETTINGS, ocr_engines: LLM_OCR_ENGINES });
    const page = await newPage();
    const job = await prepare(page);
    expect(job.payload).toMatchObject({ pipeline: { ocr_engine: "llm" } });
    const [s] = await scoped(db, A.userId).select(series, eq(series.id, A.seriesId));
    expect(job.inputRev).toBe(prepareInputRev(page.originalSha256, s?.settingsRev ?? 0, env.PIPELINE_VERSION));
  });

  it("cài đặt khác mặc định: snapshot theo ngôn ngữ nguồn, đổi input_rev; reinpaint/ocr_region theo cài đặt", async () => {
    await put({
      ...DEFAULT_PIPELINE_SETTINGS,
      inpainter: "lama_manga",
      inpaint_size: 768,
      ocr_engines: { ...DEFAULT_PIPELINE_SETTINGS.ocr_engines, ko: "paddle_ocr" },
    });
    await scoped(db, A.userId).update(series, eq(series.id, A.seriesId), { sourceLang: "ko" });
    const page = await newPage();
    const job = await prepare(page);
    expect(job.payload).toMatchObject({ pipeline: { ocr_engine: "paddle_ocr", inpainter: "lama_manga" } });
    expect(job.inputRev).not.toBe(prepareInputRev(page.originalSha256, 0, env.PIPELINE_VERSION));

    const re = await inJobTx((tx) =>
      enqueueReinpaint(tx, A.userId, {
        type: "page.reinpaint",
        page_id: page.id,
        base_clean_rev: 1,
        user_mask_key: `u/${A.userId}/pg/${page.id}/user-mask/a.png`,
        offset: { x: 0, y: 0 },
      }),
    );
    expect(re.job.payload).toMatchObject({ inpaint: { inpainter: "lama_manga", inpaint_size: 768 } });
    const ocr = await inJobTx((tx) =>
      enqueueOcrRegion(tx, A.userId, { type: "page.ocr_region", page_id: page.id, bbox: [0, 0, 10, 10] }),
    );
    expect(ocr.job.payload).toMatchObject({ ocr_engine: "paddle_ocr" });
    await put(DEFAULT_PIPELINE_SETTINGS);
  });

  it("LLM tạm dừng: page.prepare OCR local vẫn được claim, prepare LLM thì không", async () => {
    const sdb = scoped(db, A.userId);
    await sdb.delete(jobs, eq(jobs.userId, A.userId));
    // Job prepare còn sót của user khác giờ là OCR local (mặc định) → cũng claim được; huỷ để chỉ thấy job của ca này.
    await cancelActiveJobs();
    const local = await newPage();
    const llm = await newPage();
    await put({
      ...DEFAULT_PIPELINE_SETTINGS,
      ocr_engines: { ...DEFAULT_PIPELINE_SETTINGS.ocr_engines, ko: "paddle_ocr" },
    });
    await prepare(local);
    await put({ ...DEFAULT_PIPELINE_SETTINGS, ocr_engines: LLM_OCR_ENGINES });
    await prepare(llm);
    const until = new Date(Date.now() + 60_000);
    await db
      .insert(runtimeFlags)
      .values({ key: "llm_paused", until })
      .onConflictDoUpdate({ target: runtimeFlags.key, set: { until } });
    try {
      const { token } = await workerToken("mac", "pipeline-breaker");
      const got = await claimJobs(token, { caps: ["page.prepare"], max: 8 });
      expect(got.map((j) => j.payload.page_id)).toEqual([local.id]);
    } finally {
      await db.delete(runtimeFlags).where(eq(runtimeFlags.key, "llm_paused"));
    }
  });
});
