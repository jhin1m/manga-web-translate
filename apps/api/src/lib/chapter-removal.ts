/**
 * Xoá chương / series: huỷ job đang chạy → xoá hàng DB (FK cascade dọn pages, page_states, jobs…) → dọn object
 * MinIO của chương (`ws/{ws}/ch/{id}/`) và của từng page (`ws/{ws}/pg/{id}/`). Chương người khác đang giữ khoá
 * (đang sửa) thì từ chối 423 — không xoá dưới tay người đang làm.
 */
import { chapters, jobs, pages, type Scoped } from "@mtl/db";
import { ACTIVE_JOB_STATUSES } from "@mtl/shared";
import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { cancelJob } from "../jobs/queue.ts";
import { deletePrefix } from "../storage.ts";
import { activeLockHolder } from "./chapter-lock.ts";
import { memberNames } from "./member-names.ts";

type Chapter = typeof chapters.$inferSelect;

/**
 * Huỷ mọi job đang hoạt động của chương; lặp tới khi không còn job active (job có thể được tạo xen giữa lúc huỷ,
 * có trần vòng lặp).
 */
export async function cancelChapterJobs(sdb: Scoped, ws: string, chapterId: string): Promise<number> {
  let cancelled = 0;
  for (let round = 0; round < 5; round++) {
    const active = await sdb.select(
      jobs,
      and(eq(jobs.chapterId, chapterId), inArray(jobs.status, [...ACTIVE_JOB_STATUSES])),
    );
    if (active.length === 0) break;
    active.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const j of active) {
      const after = await cancelJob(ws, j.id);
      if (after?.status === "cancelled") cancelled++;
    }
  }
  return cancelled;
}

/** 423 nếu có chương đang bị người khác (không phải `userId`) giữ khoá còn hạn. */
async function assertNotLockedByOthers(ws: string, chs: Chapter[], userId: string): Promise<void> {
  const holder = chs.map((ch) => activeLockHolder(ch)).find((h) => h !== null && h !== userId);
  if (!holder) return;
  const names = await memberNames(ws, [holder]);
  throw new HTTPException(423, {
    res: Response.json({ error: "chapter_locked", holder, holder_name: names.get(holder) ?? null }, { status: 423 }),
  });
}

/**
 * Xoá các chương bằng `deleteRows` (xoá hàng chương, hoặc hàng series để cascade xuống chương). Object storage
 * dọn sau khi DB đã xoá: lỗi dọn chỉ để lại file mồ côi, không làm hỏng thao tác của người dùng.
 */
export async function removeChapters(
  sdb: Scoped,
  ws: string,
  userId: string,
  chs: Chapter[],
  deleteRows: () => Promise<void>,
): Promise<void> {
  await assertNotLockedByOthers(ws, chs, userId);
  for (const ch of chs) await cancelChapterJobs(sdb, ws, ch.id);
  const ids = chs.map((ch) => ch.id);
  const pageRows = ids.length ? await sdb.select(pages, inArray(pages.chapterId, ids)) : [];
  await deleteRows();
  const prefixes = [...ids.map((id) => `ws/${ws}/ch/${id}/`), ...pageRows.map((p) => `ws/${ws}/pg/${p.id}/`)];
  try {
    for (let i = 0; i < prefixes.length; i += 8) {
      await Promise.all(prefixes.slice(i, i + 8).map(deletePrefix));
    }
  } catch (err) {
    console.error("[chapter-removal] dọn storage thất bại", err);
  }
}

export const chaptersOf = (sdb: Scoped, seriesId: string) => sdb.select(chapters, eq(chapters.seriesId, seriesId));
