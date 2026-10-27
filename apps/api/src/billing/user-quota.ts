/**
 * Hạn mức chi phí mỗi người dùng mỗi ngày UTC (USER_DAILY_USD) — cùng cửa sổ ngày với kill-switch toàn cục
 * (budget.ts), tính MỌI chi phí của user trong usage_ledger (token LLM + GPU). Một tài khoản vượt không làm cạn
 * ngân sách chung của người khác:
 * - endpoint tạo job LLM → 402 `quota_exceeded` (`assertQuota`);
 * - claim / runner: job LLM đang chờ của user vượt → `failed` (không pause: chương không kẹt `processing`);
 *   claim không trả job LLM của họ, token Modal không nhận job nào của họ (job không-LLM chỉ chạy trên Mac, $0);
 * - heartbeat: job LLM đang chạy của user vượt → dừng + `failed`;
 * - dispatcher: không tính job của user vượt khi quyết định bật Modal.
 */
import { type DbLike, jobs, usageLedger } from "@mtl/db";
import { QUOTA_EXCEEDED } from "@mtl/shared";
import { and, eq, gte, not, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { env } from "../env.ts";
import { llmJobSql } from "../jobs/llm-job-filter.ts";

const dayStart = sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;

export type QuotaStatus = { spent_usd: number; limit_usd: number | null; resets_at: string; exceeded: boolean };

/**
 * SQL "user của cột này đã vượt hạn mức hôm nay" — tính theo từng dòng (user chưa có ledger hôm nay vẫn đúng).
 * Ngưỡng 0 = chặn hết; không đặt = không giới hạn.
 */
export function overQuotaSql(userIdCol: AnyPgColumn, limit = env.USER_DAILY_USD): SQL {
  if (limit === undefined) return sql`false`;
  if (limit === 0) return sql`true`;
  return sql`(coalesce((select sum(${usageLedger.costUsd}) from ${usageLedger} where ${usageLedger.userId} = ${userIdCol} and ${usageLedger.createdAt} >= ${dayStart}), 0) >= ${limit})`;
}

/**
 * Job worker loại `kind` được claim (ngoài trạng thái/loại/breaker): job LLM của người vượt hạn mức không ai nhận;
 * Modal không nhận job nào của họ. Dispatcher dùng chung để không bật Modal cho job Modal không được nhận.
 */
export const claimableSql = (kind: "mac" | "modal"): SQL =>
  kind === "modal" ? not(overQuotaSql(jobs.userId)) : not(and(llmJobSql, overQuotaSql(jobs.userId)) as SQL);

export async function userQuotaStatus(t: DbLike, userId: string, limit = env.USER_DAILY_USD): Promise<QuotaStatus> {
  const [row] = await t
    .select({
      spent: sql<string>`coalesce(sum(${usageLedger.costUsd}), 0)`,
      resets: sql<string>`to_char((date_trunc('day', now() at time zone 'utc') + interval '1 day'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
    })
    .from(usageLedger)
    .where(and(eq(usageLedger.userId, userId), gte(usageLedger.createdAt, dayStart)));
  const spent = Number(row?.spent ?? 0);
  const limitUsd = limit ?? null;
  return {
    spent_usd: Math.round(spent * 1e4) / 1e4,
    limit_usd: limitUsd,
    resets_at: row?.resets ?? "",
    exceeded: limitUsd !== null && (limitUsd === 0 || spent >= limitUsd),
  };
}

/** Endpoint tạo job LLM: user đã vượt hạn mức hôm nay → 402. */
export async function assertQuota(t: DbLike, userId: string): Promise<void> {
  if (env.USER_DAILY_USD === undefined) return;
  const q = await userQuotaStatus(t, userId);
  if (!q.exceeded) return;
  throw new HTTPException(402, {
    res: Response.json(
      { error: QUOTA_EXCEEDED, spent_usd: q.spent_usd, limit_usd: q.limit_usd, resets_at: q.resets_at },
      { status: 402 },
    ),
  });
}

/** Lời nhắn lưu ở `jobs.error` khi job bị dừng vì hạn mức (web nhận ra qua tiền tố). */
export const quotaFailMessage = () => `${QUOTA_EXCEEDED}: vượt hạn mức $${env.USER_DAILY_USD ?? 0}/ngày`;

/** Job LLM đang chờ của user vượt hạn mức (khoá dòng, bỏ dòng worker khác đang giữ). */
export async function lockQueuedOverQuotaLlmJobs(t: DbLike) {
  if (env.USER_DAILY_USD === undefined) return [];
  return t
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "queued"), llmJobSql, overQuotaSql(jobs.userId)))
    .for("update", { skipLocked: true });
}
