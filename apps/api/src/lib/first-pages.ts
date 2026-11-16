/**
 * Trang đầu không bỏ qua (`skip` null, ord nhỏ nhất) làm thumbnail chương / bìa series. Mỗi hàm đúng 1 câu SQL cho
 * cả danh sách → không N+1. Mỗi chương chỉ lấy đúng 1 trang đầu bằng LATERAL + LIMIT 1 (đi theo index
 * `source_files(chapter_id, ord)`), không sắp xếp toàn bộ trang của thư viện. Lọc `user_id` tường minh (bảng
 * `chapters` và `source_files`).
 */
import { sql } from "drizzle-orm";
import { db } from "../db.ts";

export const thumbUrl = (fileId: string) => `/api/thumbs/${fileId}`;

const uuidList = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/** chapterId → URL thumbnail của ảnh đầu không bỏ qua (chương không có ảnh như vậy thì không có khoá). */
export async function chapterThumbs(userId: string, chapterIds: string[]): Promise<Map<string, string>> {
  if (!chapterIds.length) return new Map();
  const rows = await db.execute<{ chapter_id: string; file_id: string }>(sql`
    SELECT c.id AS chapter_id, f.id AS file_id
    FROM chapters c
    CROSS JOIN LATERAL (
      SELECT f.id FROM source_files f
      WHERE f.chapter_id = c.id AND f.user_id = c.user_id AND f.skip IS NULL
      ORDER BY f.ord, f.id LIMIT 1) f
    WHERE c.user_id = ${userId}::uuid AND c.id IN (${uuidList(chapterIds)})`);
  return new Map(rows.map((r) => [r.chapter_id, thumbUrl(r.file_id)]));
}

/**
 * seriesId → URL thumbnail của trang đầu thuộc chương số nhỏ nhất CÓ ảnh không bỏ qua (chương toàn ảnh bỏ qua
 * thì lấy chương kế).
 */
export async function seriesCoverThumbs(userId: string, seriesIds: string[]): Promise<Map<string, string>> {
  if (!seriesIds.length) return new Map();
  const rows = await db.execute<{ series_id: string; file_id: string }>(sql`
    SELECT DISTINCT ON (c.series_id) c.series_id, f.id AS file_id
    FROM chapters c
    CROSS JOIN LATERAL (
      SELECT f.id FROM source_files f
      WHERE f.chapter_id = c.id AND f.user_id = c.user_id AND f.skip IS NULL
      ORDER BY f.ord, f.id LIMIT 1) f
    WHERE c.user_id = ${userId}::uuid AND c.series_id IN (${uuidList(seriesIds)})
    ORDER BY c.series_id, c.number, c.created_at, c.id`);
  return new Map(rows.map((r) => [r.series_id, thumbUrl(r.file_id)]));
}
