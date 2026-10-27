/**
 * Entry glossary nào áp cho một series — dùng chung cho snapshot dịch (jobs/enqueue.ts translateSettings) và
 * "áp lại glossary" (routes/find-replace.ts) để hai nơi không lệch nhau.
 */
import { glossaryEntries, type series } from "@mtl/db";
import { and, eq, isNull, or, type SQL } from "drizzle-orm";

type SeriesScope = Pick<typeof series.$inferSelect, "id" | "userId" | "sourceLang" | "targetLang">;

/**
 * Entry riêng của series + entry chung đúng cặp nguồn→đích, luôn trong dữ liệu của chủ series (caller có thể đọc
 * qua DbLike thô, không có Scoped tự thêm user_id).
 */
export const seriesGlossaryWhere = (s: SeriesScope): SQL =>
  and(
    eq(glossaryEntries.userId, s.userId),
    or(
      eq(glossaryEntries.seriesId, s.id),
      and(
        isNull(glossaryEntries.seriesId),
        eq(glossaryEntries.sourceLang, s.sourceLang),
        eq(glossaryEntries.targetLang, s.targetLang),
      ),
    ),
  ) as SQL;

/** Entry chung trước, series sau → entry series thắng khi trùng source_term. */
export function mergeBySourceTerm<E extends { seriesId: string | null; sourceTerm: string }>(
  entries: E[],
): Map<string, E> {
  const map = new Map<string, E>();
  for (const e of [...entries].sort((a, b) => Number(a.seriesId !== null) - Number(b.seriesId !== null))) {
    map.set(e.sourceTerm, e);
  }
  return map;
}
