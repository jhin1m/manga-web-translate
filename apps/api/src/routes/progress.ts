/**
 * Tiến độ chương cho UI polling 2–3s (không SSE, red team #13): trạng thái chapter + từng page + job đang/vừa chạy.
 * Một lượt gồm 4 truy vấn cố định (chapter, pages, jobs, page_states), không N+1.
 */
import { chapters, jobs, pageStates, pages } from "@mtl/db";
import { ACTIVE_JOB_STATUSES } from "@mtl/shared";
import { and, eq, gt, inArray, or } from "drizzle-orm";
import { Hono } from "hono";
import { type AppEnv, requireWorkspace } from "../middleware/workspace.ts";
import { jobView } from "./jobs.ts";

const RECENT_MS = 24 * 60 * 60 * 1000;

export const progressRoutes = new Hono<AppEnv>();

progressRoutes.get("/w/:ws/chapters/:chapterId/progress", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  const [pageRows, jobRows] = await Promise.all([
    sdb.select(pages, eq(pages.chapterId, ch.id)),
    // Chỉ job đang hoạt động hoặc vừa kết thúc (24h) — lịch sử job của chương không phình theo thời gian poll.
    sdb.select(
      jobs,
      and(
        eq(jobs.chapterId, ch.id),
        or(inArray(jobs.status, [...ACTIVE_JOB_STATUSES]), gt(jobs.updatedAt, new Date(Date.now() - RECENT_MS))),
      ),
    ),
  ]);
  const states = pageRows.length
    ? await sdb.select(
        pageStates,
        inArray(
          pageStates.pageId,
          pageRows.map((p) => p.id),
        ),
      )
    : [];
  const stateBy = new Map(states.map((s) => [s.pageId, s]));
  // Job mới nhất theo page (đang chạy ưu tiên).
  const sorted = [...jobRows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const active = (s: string) => (ACTIVE_JOB_STATUSES as readonly string[]).includes(s);
  const latestByPage = new Map<string, (typeof jobRows)[number]>();
  for (const j of sorted) {
    if (!j.pageId) continue;
    const cur = latestByPage.get(j.pageId);
    if (!cur || (!active(cur.status) && active(j.status))) latestByPage.set(j.pageId, j);
  }
  const chapterJobs = sorted.filter((j) => j.type === "chapter.ingest" || j.type === "chapter.translate").slice(0, 5);
  const counts: Record<string, number> = {};
  // Trang ẩn vẫn trả về (rail lọc "Đã xoá" để khôi phục) nhưng không đếm.
  for (const p of pageRows) if (!p.skipped) counts[p.status] = (counts[p.status] ?? 0) + 1;
  return c.json({
    chapter: { id: ch.id, status: ch.status, ingest_rev: ch.ingestRev },
    counts,
    pages: pageRows
      .sort((a, b) => a.ord - b.ord)
      .map((p) => {
        const j = latestByPage.get(p.id);
        const st = stateBy.get(p.id);
        return {
          id: p.id,
          ord: p.ord,
          status: p.status,
          width: p.width,
          height: p.height,
          clean_rev: p.cleanRev,
          cut_flag: p.cutFlag,
          skipped: p.skipped,
          ai_update_available: st?.aiUpdateAvailable ?? false,
          version: st?.version ?? 0,
          job: j ? jobView({ ...j, result: null }) : null,
        };
      }),
    jobs: chapterJobs.map((j) => jobView({ ...j, result: null })),
  });
});
