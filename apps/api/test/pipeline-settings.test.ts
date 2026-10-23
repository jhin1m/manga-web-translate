/** Cài đặt pipeline cấp workspace: quyền, validate, snapshot vào payload job, input_rev giữ nguyên khi mặc định. */
import { randomUUID } from "node:crypto";
import { chapters, jobs, pages, runtimeFlags, scoped, series } from "@mtl/db";
import { DEFAULT_PIPELINE_SETTINGS, type PipelineSettings, prepareInputRev } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { INVITATION_HEADER, INVITATION_TOKEN_HEADER } from "../src/auth.ts";
import { env } from "../src/env.ts";
import { enqueueOcrRegion, enqueuePrepare, enqueueReinpaint, inJobTx } from "../src/jobs/enqueue.ts";
import { call, cookieFrom, db, invite, PASSWORD, seedWorkspace, uniq } from "./helpers.ts";
import { claimJobs, workerToken } from "./worker-helpers.ts";

type Seed = Awaited<ReturnType<typeof seedWorkspace>>;
let A: Seed;

async function joinAsMember(): Promise<string> {
  const email = `${uniq("member")}@example.com`;
  const id = await invite(A.cookie, A.workspaceId, email);
  const link = await call(`/api/w/${A.workspaceId}/invitations/${id}/link`, { cookie: A.cookie });
  const t = new URL(((await link.json()) as { link: string }).link).searchParams.get("token") ?? "";
  const res = await call("/api/auth/sign-up/email", {
    method: "POST",
    body: { email, password: PASSWORD, name: "Lan" },
    headers: { [INVITATION_HEADER]: id, [INVITATION_TOKEN_HEADER]: t },
  });
  const cookie = cookieFrom(res);
  await call("/api/auth/organization/accept-invitation", { method: "POST", cookie, body: { invitationId: id } });
  return cookie;
}

const put = (pipeline: unknown, cookie = A.cookie) =>
  call(`/api/w/${A.workspaceId}/settings/pipeline`, { method: "PUT", cookie, body: { pipeline } });

async function newPage() {
  return scoped(db, A.workspaceId).insert(pages, {
    id: randomUUID(),
    chapterId: A.chapterId,
    ord: 0,
    width: 800,
    height: 1200,
    originalKey: `ws/${A.workspaceId}/x.png`,
    originalSha256: "cd".repeat(32),
  });
}

async function prepare(page: typeof pages.$inferSelect) {
  const sdb = scoped(db, A.workspaceId);
  const [s] = await sdb.select(series, eq(series.id, A.seriesId));
  const [ch] = await sdb.select(chapters, eq(chapters.id, A.chapterId));
  await sdb.delete(jobs, eq(jobs.pageId, page.id));
  return (await inJobTx((tx) => enqueuePrepare(tx, page, s as never, ch as never))).job;
}

beforeAll(async () => {
  A = await seedWorkspace("pipeline");
});

describe("pipeline settings", () => {
  it("GET trả mặc định khi chưa cấu hình; owner lưu được, member bị 403", async () => {
    const ws = await call(`/api/w/${A.workspaceId}`, { cookie: A.cookie });
    expect(((await ws.json()) as { settings: { pipeline: PipelineSettings } }).settings.pipeline).toEqual(
      DEFAULT_PIPELINE_SETTINGS,
    );
    const custom: PipelineSettings = {
      ...DEFAULT_PIPELINE_SETTINGS,
      inpainter: "lama_manga",
      ocr_engines: { ...DEFAULT_PIPELINE_SETTINGS.ocr_engines, ja: "manga_ocr", ko: "paddle_ocr" },
      mask_dilation: 4,
    };
    const res = await put(custom);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { pipeline: PipelineSettings }).pipeline).toEqual(custom);
    const member = await joinAsMember();
    expect((await put(DEFAULT_PIPELINE_SETTINGS, member)).status).toBe(403);
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

  it("mặc định: payload mang pipeline mặc định, input_rev y như trước khi có cài đặt", async () => {
    await put(DEFAULT_PIPELINE_SETTINGS);
    const page = await newPage();
    const job = await prepare(page);
    expect(job.payload).toMatchObject({ pipeline: { detector: "rtdetr_v2_comic", ocr_engine: "llm" } });
    const [s] = await scoped(db, A.workspaceId).select(series, eq(series.id, A.seriesId));
    expect(job.inputRev).toBe(prepareInputRev(page.originalSha256, s?.settingsRev ?? 0, env.PIPELINE_VERSION));
  });

  it("cài đặt khác mặc định: snapshot theo ngôn ngữ nguồn, đổi input_rev; reinpaint/ocr_region theo cài đặt", async () => {
    await put({
      ...DEFAULT_PIPELINE_SETTINGS,
      inpainter: "lama_manga",
      inpaint_size: 768,
      ocr_engines: { ...DEFAULT_PIPELINE_SETTINGS.ocr_engines, ko: "paddle_ocr" },
    });
    await scoped(db, A.workspaceId).update(series, eq(series.id, A.seriesId), { sourceLang: "ko" });
    const page = await newPage();
    const job = await prepare(page);
    expect(job.payload).toMatchObject({ pipeline: { ocr_engine: "paddle_ocr", inpainter: "lama_manga" } });
    expect(job.inputRev).not.toBe(prepareInputRev(page.originalSha256, 0, env.PIPELINE_VERSION));

    const re = await inJobTx((tx) =>
      enqueueReinpaint(tx, A.workspaceId, {
        type: "page.reinpaint",
        page_id: page.id,
        base_clean_rev: 1,
        user_mask_key: `ws/${A.workspaceId}/pg/${page.id}/user-mask/a.png`,
        offset: { x: 0, y: 0 },
      }),
    );
    expect(re.job.payload).toMatchObject({ inpaint: { inpainter: "lama_manga", inpaint_size: 768 } });
    const ocr = await inJobTx((tx) =>
      enqueueOcrRegion(tx, A.workspaceId, { type: "page.ocr_region", page_id: page.id, bbox: [0, 0, 10, 10] }),
    );
    expect(ocr.job.payload).toMatchObject({ ocr_engine: "paddle_ocr" });
    await put(DEFAULT_PIPELINE_SETTINGS);
  });

  it("LLM tạm dừng: page.prepare OCR local vẫn được claim, prepare LLM thì không", async () => {
    const sdb = scoped(db, A.workspaceId);
    await sdb.delete(jobs, eq(jobs.workspaceId, A.workspaceId));
    const local = await newPage();
    const llm = await newPage();
    await put({
      ...DEFAULT_PIPELINE_SETTINGS,
      ocr_engines: { ...DEFAULT_PIPELINE_SETTINGS.ocr_engines, ko: "paddle_ocr" },
    });
    await prepare(local);
    await put(DEFAULT_PIPELINE_SETTINGS);
    await prepare(llm);
    const until = new Date(Date.now() + 60_000);
    await db
      .insert(runtimeFlags)
      .values({ key: "llm_paused", until })
      .onConflictDoUpdate({ target: runtimeFlags.key, set: { until } });
    try {
      const { token } = await workerToken(A.workspaceId, "pipeline-breaker");
      const got = await claimJobs(token, { caps: ["page.prepare"], max: 8 });
      expect(got.map((j) => j.payload.page_id)).toEqual([local.id]);
    } finally {
      await db.delete(runtimeFlags).where(eq(runtimeFlags.key, "llm_paused"));
    }
  });
});
