/**
 * AI hiệu đính (job `chapter.proofread`): chạy cho cả chương, đọc gợi ý theo vùng chữ, bỏ từng gợi ý. "Nhận" gợi ý
 * là sửa bản dịch thường ở editor (PUT page state: khoá chương, version, lịch sử) — không có route riêng.
 */
import { chapters, jobs, proofreadSuggestions } from "@mtl/db";
import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { enqueueProofread, inJobTx } from "../jobs/enqueue.ts";
import { parseJson } from "../lib/validate.ts";
import { type AppEnv, requireWorkspace } from "../middleware/workspace.ts";
import { jobView } from "./jobs.ts";

export const proofreadRoutes = new Hono<AppEnv>();

proofreadRoutes.post("/w/:ws/chapters/:chapterId/proofread", requireWorkspace(), async (c) => {
  const ch = await c.get("sdb").byId(chapters, c.req.param("chapterId"), "chapter");
  const { job, created } = await inJobTx((tx) => enqueueProofread(tx, c.get("workspaceId"), ch.id));
  return c.json({ job: jobView(job), created }, 202);
});

/** Lần hiệu đính gần nhất của chương (null = chưa chạy) + gợi ý chưa bỏ. */
proofreadRoutes.get("/w/:ws/chapters/:chapterId/proofread", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  // Chỉ lượt gần nhất (max created_at), không kéo payload mọi lượt cũ mỗi lần poll.
  const ofChapter = and(eq(jobs.chapterId, ch.id), eq(jobs.type, "chapter.proofread")) as SQL;
  const last = await sdb.find(
    jobs,
    and(
      ofChapter,
      sql`${jobs.createdAt} = (select max(j.created_at) from jobs j where j.chapter_id = ${ch.id} and j.type = 'chapter.proofread')`,
    ) as SQL,
  );
  const rows = await sdb.select(
    proofreadSuggestions,
    and(eq(proofreadSuggestions.chapterId, ch.id), isNull(proofreadSuggestions.dismissedAt)) as SQL,
  );
  return c.json({
    job: last ? jobView(last) : null,
    suggestions: rows.map((r) => ({
      id: r.id,
      page_id: r.pageId,
      region_id: r.regionId,
      old: r.oldText,
      suggestion: r.suggestion,
      reason: r.reason,
      created_at: r.createdAt,
    })),
  });
});

/** "Bỏ" gợi ý (dismissed: false = hoàn tác). */
proofreadRoutes.patch("/w/:ws/proofread-suggestions/:suggestionId", requireWorkspace(), async (c) => {
  const body = await parseJson(c, z.object({ dismissed: z.boolean() }));
  const sdb = c.get("sdb");
  const row = await sdb.byId(proofreadSuggestions, c.req.param("suggestionId"), "suggestion");
  await sdb.update(proofreadSuggestions, eq(proofreadSuggestions.id, row.id), {
    dismissedAt: body.dismissed ? new Date() : null,
  });
  return c.json({ id: row.id, dismissed: body.dismissed });
});
