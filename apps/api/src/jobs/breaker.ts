/**
 * Circuit breaker LLM theo provider: ≥ 5 lỗi provider/rate_limited trong 5 phút của MỘT provider → runtime_flags
 * `llm_paused:<provider_id>`.until = now+2' → claim bỏ qua job LLM dùng provider đó (job dùng provider khác vẫn chạy).
 * Job không có `payload.llm` (chạy bằng env worker) dùng khoá `env` = hàng `llm_errors` / `llm_paused` có từ trước.
 * Cửa sổ lỗi lưu ở runtime_flags `llm_errors[:<provider_id>]` (khoá dòng khi ghi).
 */
import { type DbLike, jobs, runtimeFlags } from "@mtl/db";
import type { JobPayload } from "@mtl/shared";
import { eq, gt, type SQL, sql } from "drizzle-orm";
import { llmJobSql } from "./llm-job-filter.ts";

export const BREAKER_THRESHOLD = 5;
export const BREAKER_WINDOW_MS = 5 * 60 * 1000;
export const BREAKER_PAUSE_MS = 2 * 60 * 1000;
/** Khoá breaker của job chạy bằng env worker. */
export const ENV_BREAKER = "env";
const ERRORS_PREFIX = "llm_errors";
const PAUSED_PREFIX = "llm_paused";

const errorsKey = (k: string) => (k === ENV_BREAKER ? ERRORS_PREFIX : `${ERRORS_PREFIX}:${k}`);
const pausedKey = (k: string) => (k === ENV_BREAKER ? PAUSED_PREFIX : `${PAUSED_PREFIX}:${k}`);

/** Các khoá breaker mà lỗi của job này được tính vào: mỗi provider khác nhau trong `payload.llm`; không có → env. */
export function breakerKeysOf(payload: JobPayload): string[] {
  const refs = "llm" in payload ? Object.values(payload.llm ?? {}) : [];
  const ids = [...new Set(refs.map((r) => r.provider_id))];
  // Sắp xếp để mọi job khoá hàng breaker theo cùng một thứ tự (tránh deadlock khi 2 job lỗi cùng lúc).
  return ids.length ? ids.sort() : [ENV_BREAKER];
}

/** Khoá breaker đang pause (còn hạn): `env` và/hoặc provider_id. */
export async function pausedBreakerKeys(tx: DbLike, now = new Date()): Promise<string[]> {
  const rows = await tx.select({ key: runtimeFlags.key }).from(runtimeFlags).where(gt(runtimeFlags.until, now));
  return rows.flatMap(({ key }) =>
    key === PAUSED_PREFIX
      ? [ENV_BREAKER]
      : key.startsWith(`${PAUSED_PREFIX}:`)
        ? [key.slice(PAUSED_PREFIX.length + 1)]
        : [],
  );
}

/**
 * Job LLM bị chặn bởi breaker: dùng provider đang pause, hoặc (không `payload.llm`) env đang pause. Job OCR local
 * (không gọi LLM) không bao giờ bị chặn. `paused` rỗng → không có gì để chặn (caller bỏ điều kiện).
 */
export function breakerBlockedSql(paused: string[]): SQL {
  const providers = paused.filter((k) => k !== ENV_BREAKER);
  const providerHit = providers.length
    ? sql`(jsonb_typeof(${jobs.payload}->'llm') = 'object' and exists (select 1 from jsonb_each(${jobs.payload}->'llm') e where e.value->>'provider_id' in (${sql.join(
        providers.map((p) => sql`${p}`),
        sql`, `,
      )})))`
    : sql`false`;
  const envHit = paused.includes(ENV_BREAKER) ? sql`(${jobs.payload}->'llm') is null` : sql`false`;
  return sql`(${llmJobSql} and (${envHit} or ${providerHit}))`;
}

/** Ghi 1 lỗi provider cho khoá `key`; đủ ngưỡng → bật pause. Trả true nếu lần này bật breaker. */
export async function recordProviderError(tx: DbLike, key: string, now = new Date()): Promise<boolean> {
  const ERRORS_KEY = errorsKey(key);
  const PAUSED_KEY = pausedKey(key);
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
