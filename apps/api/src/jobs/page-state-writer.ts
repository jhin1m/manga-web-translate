/**
 * Luật AI-không-ghi-đè (red team #1, #6) khi chapter.translate complete cho page p:
 *   history ← (version, state) hiện tại; ai_state ← mới; ai_rev += 1; version += 1
 *   state_origin = 'ai' VÀ chương không bị khoá → state ← ai_state
 *   ngược lại → ai_update_available = true (editor merge theo vùng ở Phase 5)
 * version không bao giờ reset; page_state_history giữ 50 bản mới nhất mỗi page.
 */
import { type DbLike, pageStateHistory, pageStates } from "@mtl/db";
import type { PageState } from "@mtl/shared";
import { and, eq, lt, sql } from "drizzle-orm";

export const HISTORY_KEEP = 50;

export type AiWriteOutcome = "applied" | "ai_update_available";

/** Ghi kết quả AI cho 1 page trong transaction của complete; khoá dòng page_states để không đua với editor. */
export async function writeAiState(
  tx: DbLike,
  opts: { userId: string; pageId: string; aiState: PageState; actor: string; chapterLocked: boolean },
): Promise<AiWriteOutcome> {
  const [cur] = await tx
    .select()
    .from(pageStates)
    .where(and(eq(pageStates.pageId, opts.pageId), eq(pageStates.userId, opts.userId)))
    .for("update");
  if (!cur) throw new Error(`page_states missing for page ${opts.pageId}`);

  await tx.insert(pageStateHistory).values({
    userId: opts.userId,
    pageId: opts.pageId,
    version: cur.version,
    state: cur.state,
    actor: opts.actor,
  });
  const apply = cur.stateOrigin === "ai" && !opts.chapterLocked;
  await tx
    .update(pageStates)
    .set({
      aiState: opts.aiState,
      aiRev: sql`${pageStates.aiRev} + 1`,
      version: sql`${pageStates.version} + 1`,
      updatedBy: opts.actor,
      ...(apply ? { state: opts.aiState, aiUpdateAvailable: false } : { aiUpdateAvailable: true }),
    })
    .where(eq(pageStates.pageId, opts.pageId));
  await pruneHistory(tx, opts.pageId);
  return apply ? "applied" : "ai_update_available";
}

/** Xoá bản lịch sử cũ hơn bản thứ HISTORY_KEEP (theo version) của page. */
export async function pruneHistory(tx: DbLike, pageId: string): Promise<void> {
  const [edge] = await tx
    .select({ version: pageStateHistory.version })
    .from(pageStateHistory)
    .where(eq(pageStateHistory.pageId, pageId))
    .orderBy(sql`${pageStateHistory.version} desc`, sql`${pageStateHistory.createdAt} desc`)
    .offset(HISTORY_KEEP - 1)
    .limit(1);
  if (!edge) return;
  await tx
    .delete(pageStateHistory)
    .where(and(eq(pageStateHistory.pageId, pageId), lt(pageStateHistory.version, edge.version)));
}
