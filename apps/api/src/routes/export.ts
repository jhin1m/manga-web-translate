/**
 * Xuất chương PNG/ZIP/CBZ: render phía server (worker, cùng render.py với auto-typeset) từ page_state chốt lúc
 * claim. File nằm ở `ws/{ws}/ch/{ch}/export/{jobId}.{zip|cbz}`, chỉ tải qua endpoint có xác thực → 302 tới presigned
 * GET ≤ 5' + `Content-Disposition: attachment` (không phát link dài hạn). Lifecycle MinIO xoá file sau 7 ngày
 * (tag `EXPORT_OBJECT_TAG`); quá hạn → 410.
 */
import { chapters, jobs, type Scoped, series } from "@mtl/db";
import {
  EXPORT_FILE,
  EXPORT_RETENTION_DAYS,
  ExportFormat,
  ExportLayout,
  type JobPayload,
  type JobResult,
  keyBelongsToWorkspace,
  storageKeys,
} from "@mtl/shared";
import { and, eq, gt, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { enqueueExport, inJobTx } from "../jobs/enqueue.ts";
import { parseJson } from "../lib/validate.ts";
import { type AppEnv, requireWorkspace } from "../middleware/workspace.ts";
import { EXPORT_GET_TTL_S, head, presignGet } from "../storage.ts";

type Job = typeof jobs.$inferSelect;
type ExportPayload = Extract<JobPayload, { type: "chapter.export" }>;

const RETENTION_MS = EXPORT_RETENTION_DAYS * 24 * 3600 * 1000;
const LIST_LIMIT = 10;

const ExportBody = z.object({
  format: ExportFormat,
  layout: ExportLayout,
  quality: z.number().int().min(1).max(100).default(90),
  include_untranslated: z.boolean().default(false),
});

const httpError = (status: 404 | 409 | 410, error: string, message = error) =>
  new HTTPException(status, { res: Response.json({ error, message }, { status }) });

/** Hết hạn tính từ lúc job xong (updated_at của job succeeded). */
const expiresAt = (j: Job) => (j.status === "succeeded" ? new Date(j.updatedAt.getTime() + RETENTION_MS) : null);

function exportView(ws: string, j: Job) {
  const p = j.payload as ExportPayload;
  const r = j.result as Extract<JobResult, { type: "chapter.export" }> | null;
  const exp = expiresAt(j);
  const downloadable = exp !== null && exp.getTime() > Date.now();
  return {
    id: j.id,
    status: j.status,
    progress: j.progress,
    stage: j.stage,
    error: j.error,
    format: p.format,
    layout: p.layout,
    quality: p.quality,
    include_untranslated: p.include_untranslated,
    bytes: r?.bytes ?? null,
    created_at: j.createdAt,
    expires_at: exp,
    download_url: downloadable ? `/api/w/${ws}/exports/${j.id}/download` : null,
  };
}

/** Tên file tải về: `{series}-ch{number}.{ext}`; bản ASCII cho `filename`, bản UTF-8 cho `filename*`. */
export function attachmentDisposition(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|\p{Cc}]+/gu, "_").trim() || "export";
  const ascii =
    safe
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .replace(/[^\w.\- ]+/g, "_") || "export";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export const exportRoutes = new Hono<AppEnv>();

exportRoutes.post("/w/:ws/chapters/:chapterId/export", requireWorkspace(), async (c) => {
  const body = await parseJson(c, ExportBody);
  const ch = await c.get("sdb").byId(chapters, c.req.param("chapterId"), "chapter");
  const ws = c.get("workspaceId");
  const { job, created } = await inJobTx((tx) =>
    enqueueExport(tx, ws, { type: "chapter.export", chapter_id: ch.id, ...body }),
  );
  return c.json({ job: exportView(ws, job), created }, 202);
});

/** Export gần đây của chương (mới nhất trước) — dialog mở lại vẫn thấy file vừa xuất. */
exportRoutes.get("/w/:ws/chapters/:chapterId/exports", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  const since = new Date(Date.now() - RETENTION_MS);
  const rows = await sdb.select(
    jobs,
    and(eq(jobs.chapterId, ch.id), eq(jobs.type, "chapter.export"), gt(jobs.createdAt, since)) as SQL,
  );
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return c.json({ exports: rows.slice(0, LIST_LIMIT).map((j) => exportView(c.get("workspaceId"), j)) });
});

async function exportJob(sdb: Scoped, jobId: string): Promise<Job> {
  const job = await sdb.byId(jobs, jobId, "export");
  if (job.type !== "chapter.export") throw httpError(404, "not_found", "export not found");
  return job;
}

exportRoutes.get("/w/:ws/exports/:jobId", requireWorkspace(), async (c) => {
  return c.json(exportView(c.get("workspaceId"), await exportJob(c.get("sdb"), c.req.param("jobId"))));
});

/** 302 → presigned GET 5'. Chưa xong → 409; quá 7 ngày hoặc object đã bị lifecycle xoá → 410. */
exportRoutes.get("/w/:ws/exports/:jobId/download", requireWorkspace(), async (c) => {
  const ws = c.get("workspaceId");
  const job = await exportJob(c.get("sdb"), c.req.param("jobId"));
  if (job.status !== "succeeded") throw httpError(409, "export_not_ready", "file chưa xuất xong");
  const exp = expiresAt(job);
  const p = job.payload as ExportPayload;
  const ext = EXPORT_FILE[p.format].ext;
  const key = storageKeys.export(ws, p.chapter_id, job.id, ext);
  const r = job.result as Extract<JobResult, { type: "chapter.export" }> | null;
  // Key trong result đã được kiểm lúc complete; kiểm lại để không bao giờ ký URL ngoài workspace.
  if (!r || r.key !== key || !keyBelongsToWorkspace(key, ws)) throw httpError(404, "not_found", "export not found");
  if (!exp || exp.getTime() <= Date.now() || !(await head(key)))
    throw httpError(410, "export_expired", "file đã hết hạn");
  const sdb = c.get("sdb");
  const ch = await sdb.byId(chapters, p.chapter_id, "chapter");
  const s = await sdb.byId(series, ch.seriesId, "series");
  const url = await presignGet(key, EXPORT_GET_TTL_S, attachmentDisposition(`${s.title}-ch${ch.number}.${ext}`));
  c.header("Cache-Control", "no-store");
  return c.redirect(url, 302);
});
