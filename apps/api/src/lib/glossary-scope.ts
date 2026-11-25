/**
 * Entry glossary nào áp cho một series — dùng chung cho snapshot dịch (jobs/enqueue.ts translateSettings), "áp lại
 * glossary" (routes/find-replace.ts) và trí nhớ series (lib/series-memory.ts) để các nơi không lệch nhau.
 */
import { glossaryEntries, type series } from "@mtl/db";
import { and, eq, type SQL } from "drizzle-orm";

type SeriesScope = Pick<typeof series.$inferSelect, "id" | "userId">;

/** Entry của series, luôn trong dữ liệu của chủ series (caller có thể đọc qua DbLike thô, không có Scoped tự thêm user_id). */
export const seriesGlossaryWhere = (s: SeriesScope): SQL =>
  and(eq(glossaryEntries.userId, s.userId), eq(glossaryEntries.seriesId, s.id)) as SQL;
