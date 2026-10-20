/**
 * Circuit breaker LLM: ≥ 5 lỗi provider/rate_limited trong 5 phút → runtime_flags.llm_paused.until = now+2'
 * → claim bỏ qua các loại job cần LLM. Cửa sổ lỗi lưu ở runtime_flags.llm_errors (khoá dòng khi ghi).
 */
import { type DbLike, runtimeFlags } from "@mtl/db";
import { eq, sql } from "drizzle-orm";

export const BREAKER_THRESHOLD = 5;
export const BREAKER_WINDOW_MS = 5 * 60 * 1000;
export const BREAKER_PAUSE_MS = 2 * 60 * 1000;
const ERRORS_KEY = "llm_errors";
const PAUSED_KEY = "llm_paused";

export async function isLlmPaused(tx: DbLike, now = new Date()): Promise<boolean> {
  const [row] = await tx.select().from(runtimeFlags).where(eq(runtimeFlags.key, PAUSED_KEY)).limit(1);
  return !!row?.until && row.until > now;
}

/** Ghi 1 lỗi provider; đủ ngưỡng → bật pause. Trả true nếu lần này bật breaker. */
export async function recordProviderError(tx: DbLike, now = new Date()): Promise<boolean> {
  await tx
    .insert(runtimeFlags)
    .values({ key: ERRORS_KEY, value: { at: [] } })
    .onConflictDoNothing();
  const [row] = await tx.select().from(runtimeFlags).where(eq(runtimeFlags.key, ERRORS_KEY)).for("update");
  const cutoff = now.getTime() - BREAKER_WINDOW_MS;
  const prev = ((row?.value.at as number[] | undefined) ?? []).filter((t) => t > cutoff);
  const at = [...prev, now.getTime()].slice(-BREAKER_THRESHOLD * 4);
  await tx.update(runtimeFlags).set({ value: { at } }).where(eq(runtimeFlags.key, ERRORS_KEY));
  if (at.length < BREAKER_THRESHOLD) return false;
  const until = new Date(now.getTime() + BREAKER_PAUSE_MS);
  await tx
    .insert(runtimeFlags)
    .values({ key: PAUSED_KEY, until })
    .onConflictDoUpdate({ target: runtimeFlags.key, set: { until, updatedAt: sql`now()` } });
  // Mở lại cửa sổ: sau khi hết pause cần đủ 5 lỗi mới để bật lại.
  await tx
    .update(runtimeFlags)
    .set({ value: { at: [] } })
    .where(eq(runtimeFlags.key, ERRORS_KEY));
  return true;
}
