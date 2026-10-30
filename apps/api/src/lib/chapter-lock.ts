/**
 * Khoá chương: một tab sửa tại một thời điểm, hết hạn sau 15 phút không heartbeat. Holder = `${userId}:${tabId}`
 * (xem middleware/user.ts) → tab khác của cùng người dùng nhận 423, đóng một tab không nhả khoá của tab đang sửa.
 * Mọi đường ghi nội dung chương (PUT page state, find/replace, áp glossary) phải gọi `assertChapterLock`
 * — ép ở server, không tin client. Tab giữ khoá cả lúc chương đang dịch; job AI không cần khoá và vẫn ghi `state`
 * của trang chưa sửa tay (jobs/page-state-writer.ts). Không đua với người sửa vì trang đang dịch / chờ lượt là trang
 * bận → ghi vào nó trả 409 `page_busy`; thao tác hàng loạt cả chương khi chương đang chạy → 409 `chapter_busy`.
 */
import { chapters, type Scoped } from "@mtl/db";
import type { PAGE_STATUSES } from "@mtl/shared";
import { and, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

export const LOCK_TTL_MS = 15 * 60 * 1000;

type LockCols = { lockedBy: string | null; lockedAt: Date | null };

/** Holder đang giữ khoá còn hạn, hoặc null. */
export function activeLockHolder(ch: LockCols, now = new Date()): string | null {
  if (!ch.lockedBy || !ch.lockedAt) return null;
  return now.getTime() - ch.lockedAt.getTime() < LOCK_TTL_MS ? ch.lockedBy : null;
}

/** 423 dùng chung: chương đang mở để sửa ở tab khác. */
export const chapterLockedError = () =>
  new HTTPException(423, { res: Response.json({ error: "chapter_locked" }, { status: 423 }) });

/**
 * Lấy hoặc gia hạn khoá (dùng cho cả heartbeat). Atomic: chỉ thành công khi chưa ai giữ, chính holder này giữ,
 * hoặc khoá cũ đã hết hạn.
 */
export async function acquireChapterLock(sdb: Scoped, chapterId: string, holder: string): Promise<boolean> {
  const ch = await sdb.byId(chapters, chapterId, "chapter");
  const cutoff = new Date(Date.now() - LOCK_TTL_MS);
  const rows = await sdb.update(
    chapters,
    and(
      eq(chapters.id, ch.id),
      or(isNull(chapters.lockedBy), eq(chapters.lockedBy, holder), lt(chapters.lockedAt, cutoff)),
    ) as SQL,
    { lockedBy: holder, lockedAt: new Date() },
  );
  return rows.length > 0;
}

/** Nhả khoá nếu chính holder này giữ (không làm gì nếu không giữ). */
export async function releaseChapterLock(sdb: Scoped, chapterId: string, holder: string): Promise<void> {
  const ch = await sdb.byId(chapters, chapterId, "chapter");
  await sdb.update(chapters, and(eq(chapters.id, ch.id), eq(chapters.lockedBy, holder)) as SQL, {
    lockedBy: null,
    lockedAt: null,
  });
}

/** Người ghi phải đang giữ khoá còn hạn → không thì 423 Locked. */
export async function assertChapterLock(sdb: Scoped, chapterId: string, holder: string): Promise<void> {
  const ch = await sdb.byId(chapters, chapterId, "chapter");
  if (activeLockHolder(ch) !== holder) throw chapterLockedError();
}

/** Trang đang ở Bước 1 hoặc đang dịch. */
export const PAGE_BUSY_STATUSES: readonly (typeof PAGE_STATUSES)[number][] = ["pending", "preparing", "translating"];

/** Trang bận: đang xử lý, hoặc đang chờ lượt trong chuỗi dịch (`translate_queued`) → AI sắp ghi đè, chỉ xem. */
export const isPageBusy = (p: { status: string; translateQueued: boolean }) =>
  p.translateQueued || (PAGE_BUSY_STATUSES as readonly string[]).includes(p.status);

export const pageBusyError = () =>
  new HTTPException(409, { res: Response.json({ error: "page_busy" }, { status: 409 }) });

/** Thao tác ghi hàng loạt cả chương (find/replace, áp glossary, hoàn tác) chỉ khi chương không cắt trang / chạy AI. */
export function assertChapterIdle(ch: { status: string }): void {
  if (ch.status === "ingesting" || ch.status === "processing") {
    throw new HTTPException(409, {
      res: Response.json(
        { error: "chapter_busy", message: "chương đang xử lý — chờ xong rồi sửa hàng loạt" },
        { status: 409 },
      ),
    });
  }
}
