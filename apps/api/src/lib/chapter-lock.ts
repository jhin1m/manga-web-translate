/**
 * Khoá chương (red team #6): một người sửa tại một thời điểm, hết hạn sau 15 phút không heartbeat.
 * Mọi người ghi nội dung chương (PUT page state, find/replace, áp glossary) phải gọi `assertChapterLock`
 * — ép ở server, không tin client. Job AI không giữ khoá: thấy chương đang khoá thì không ghi đè `state`
 * (xem jobs/page-state-writer.ts).
 */
import { chapters, type Scoped } from "@mtl/db";
import { and, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

export const LOCK_TTL_MS = 15 * 60 * 1000;

type LockCols = { lockedBy: string | null; lockedAt: Date | null };

/** Người đang giữ khoá còn hạn, hoặc null. */
export function activeLockHolder(ch: LockCols, now = new Date()): string | null {
  if (!ch.lockedBy || !ch.lockedAt) return null;
  return now.getTime() - ch.lockedAt.getTime() < LOCK_TTL_MS ? ch.lockedBy : null;
}

export const isChapterLocked = (ch: LockCols, now = new Date()) => activeLockHolder(ch, now) !== null;

/**
 * Lấy hoặc gia hạn khoá (dùng cho cả heartbeat). Atomic: chỉ thành công khi chưa ai giữ, chính mình giữ,
 * hoặc khoá cũ đã hết hạn. → `{ ok: false, holder }` khi người khác đang giữ.
 */
export async function acquireChapterLock(
  sdb: Scoped,
  chapterId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; holder: string }> {
  const ch = await sdb.byId(chapters, chapterId, "chapter");
  const cutoff = new Date(Date.now() - LOCK_TTL_MS);
  const rows = await sdb.update(
    chapters,
    and(
      eq(chapters.id, ch.id),
      or(isNull(chapters.lockedBy), eq(chapters.lockedBy, userId), lt(chapters.lockedAt, cutoff)),
    ) as SQL,
    { lockedBy: userId, lockedAt: new Date() },
  );
  if (rows.length > 0) return { ok: true };
  const now = await sdb.byId(chapters, chapterId, "chapter");
  return { ok: false, holder: activeLockHolder(now) ?? "unknown" };
}

/** Nhả khoá nếu chính mình giữ (không làm gì nếu không giữ). */
export async function releaseChapterLock(sdb: Scoped, chapterId: string, userId: string): Promise<void> {
  const ch = await sdb.byId(chapters, chapterId, "chapter");
  await sdb.update(chapters, and(eq(chapters.id, ch.id), eq(chapters.lockedBy, userId)) as SQL, {
    lockedBy: null,
    lockedAt: null,
  });
}

/** Người ghi phải đang giữ khoá còn hạn → không thì 423 Locked. */
export async function assertChapterLock(sdb: Scoped, chapterId: string, userId: string): Promise<void> {
  const ch = await sdb.byId(chapters, chapterId, "chapter");
  const holder = activeLockHolder(ch);
  if (holder !== userId) {
    throw new HTTPException(423, {
      res: Response.json({ error: "chapter_locked", holder }, { status: 423 }),
    });
  }
}
