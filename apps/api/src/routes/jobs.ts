/** Job của người dùng: xem trạng thái/kết quả (VD page.ocr_region cho editor) và huỷ. */
import { jobs } from "@mtl/db";
import { Hono } from "hono";
import { cancelJob } from "../jobs/queue.ts";
import type { AppEnv } from "../middleware/user.ts";

type Job = typeof jobs.$inferSelect;

export const jobView = (j: Job) => ({
  id: j.id,
  type: j.type,
  status: j.status,
  progress: j.progress,
  stage: j.stage,
  /** Số ảnh/trang/đoạn đã xong / tổng của bước `stage` (null = bước không đếm) — UI hiện " i/n". */
  progress_done: j.progressDone,
  progress_total: j.progressTotal,
  attempts: j.attempts,
  provider_retries: j.providerRetries,
  error_class: j.errorClass,
  error: j.error,
  /** Lần chạy sớm nhất (backoff sau lỗi AI) — UI báo "tự thử lại lúc …". */
  run_after: j.runAfter,
  chapter_id: j.chapterId,
  page_id: j.pageId,
  result: j.result,
  created_at: j.createdAt,
  updated_at: j.updatedAt,
});

export const jobRoutes = new Hono<AppEnv>();

jobRoutes.get("/jobs/:jobId", async (c) => {
  const job = await c.get("sdb").byId(jobs, c.req.param("jobId"), "job");
  return c.json(jobView(job));
});

jobRoutes.post("/jobs/:jobId/cancel", async (c) => {
  const job = await c.get("sdb").byId(jobs, c.req.param("jobId"), "job");
  const after = await cancelJob(c.get("userId"), job.id);
  return c.json(jobView(after ?? job));
});
