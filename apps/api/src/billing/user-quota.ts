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
import { and, eq, gte, inArray, not, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { llmJobSql } from "../jobs/llm-job-filter.ts";
import { effectiveLimits, userDailyLimitSql } from "../lib/system-settings.ts";

/** 00:00 UTC hôm nay — mốc chung cho hạn mức user, ngân sách toàn cục và bảng chi phí. */
export const dayStart = sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;

export type QuotaStatus = { spent_usd: number; limit_usd: number | null; resets_at: string; exceeded: boolean };

/**
 * SQL "user của cột này đã vượt hạn mức hôm nay". Hạn mức hiệu lực = DB ?? env; ngưỡng ≤ 0 = chặn hết (kể cả user
 * chưa có ledger hôm nay); không đặt = không giới hạn.
 *
 * Tập user đã vượt là subquery không phụ thuộc dòng ngoài: Postgres cộng ledger hôm nay một lần cho cả câu lệnh rồi
 * băm, thay vì cộng lại cho từng job (câu chọn job của claim duyệt mọi job đang chờ).
 * `user_id is not null` là bắt buộc: ledger có dòng chi phí nền tảng không gắn user, và một NULL trong tập làm
 * `not (x in (...))` thành NULL → token Modal không claim được job nào, token Mac không claim được job LLM nào.
 * Cùng lý do, `userIdCol` phải là cột NOT NULL (hiện chỉ dùng với `jobs.user_id`).
 */
export function overQuotaSql(userIdCol: AnyPgColumn): SQL {
  const limit = userDailyLimitSql();
  return sql`(${limit} is not null and (${limit} <= 0 or ${userIdCol} in (select ${usageLedger.userId} from ${usageLedger} where ${usageLedger.userId} is not null and ${usageLedger.createdAt} >= ${dayStart} group by ${usageLedger.userId} having sum(${usageLedger.costUsd}) >= ${limit})))`;
}

/** Chủ job không bị khoá: job của tài khoản bị khoá nằm yên trong hàng đợi (mở khoá thì chạy tiếp). */
export const notDisabledOwnerSql = sql`not exists (select 1 from "user" u where u.id = ${jobs.userId} and u.disabled_at is not null)`;

/**
 * Job worker loại `kind` được claim (ngoài trạng thái/loại/breaker): job LLM của người vượt hạn mức không ai nhận;
 * Modal không nhận job nào của họ; job của tài khoản bị khoá không ai nhận (job đang chạy thì chạy nốt). Dispatcher dùng chung để không bật Modal cho job Modal không được nhận.
 */
export const claimableSql = (kind: "mac" | "modal"): SQL => {
  const quota =
    kind === "modal" ? not(overQuotaSql(jobs.userId)) : not(and(llmJobSql, overQuotaSql(jobs.userId)) as SQL);
  return and(quota, notDisabledOwnerSql) as SQL;
};

export async function userQuotaStatus(t: DbLike, userId: string, limit?: number | null): Promise<QuotaStatus> {
  const effective = limit === undefined ? (await effectiveLimits(t)).userDailyUsd : limit;
  const [row] = await t
    .select({
      spent: sql<string>`coalesce(sum(${usageLedger.costUsd}), 0)`,
      resets: sql<string>`to_char((date_trunc('day', now() at time zone 'utc') + interval '1 day'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
    })
    .from(usageLedger)
    .where(and(eq(usageLedger.userId, userId), gte(usageLedger.createdAt, dayStart)));
  const spent = Number(row?.spent ?? 0);
  const limitUsd = effective;
  return {
    spent_usd: Math.round(spent * 1e4) / 1e4,
    limit_usd: limitUsd,
    resets_at: row?.resets ?? "",
    exceeded: limitUsd !== null && (limitUsd === 0 || spent >= limitUsd),
  };
}

/** Endpoint tạo job LLM: user đã vượt hạn mức hôm nay → 402. */
export async function assertQuota(t: DbLike, userId: string): Promise<void> {
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
export async function quotaFailMessage(t: DbLike): Promise<string> {
  return `${QUOTA_EXCEEDED}: vượt hạn mức $${(await effectiveLimits(t)).userDailyUsd ?? 0}/ngày`;
}

/** Job LLM đang chờ của user vượt hạn mức (khoá dòng, bỏ dòng worker khác đang giữ). */
export async function lockQueuedOverQuotaLlmJobs(t: DbLike) {
  // Không có hạn mức hiệu lực (DB lẫn env đều null) → không job nào vượt: khỏi quét bảng jobs.
  if ((await effectiveLimits(t)).userDailyUsd === null) return [];
  return t
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "queued"), llmJobSql, overQuotaSql(jobs.userId)))
    .for("update", { skipLocked: true });
}

export type TodaySpend = { global_spent_usd: number; max_user_spent_usd: number };

/** Chi tiêu hôm nay (ngày UTC): toàn hệ thống (gồm chi phí nền tảng không gắn user) + người chi nhiều nhất. */
export async function todaySpend(t: DbLike): Promise<TodaySpend> {
  const rows = await t
    .select({ userId: usageLedger.userId, spent: sql<string>`sum(${usageLedger.costUsd})` })
    .from(usageLedger)
    .where(gte(usageLedger.createdAt, dayStart))
    .groupBy(usageLedger.userId);
  let global = 0;
  let maxUser = 0;
  for (const r of rows) {
    const v = Number(r.spent);
    global += v;
    if (r.userId !== null) maxUser = Math.max(maxUser, v);
  }
  const round = (n: number) => Math.round(n * 1e4) / 1e4;
  return { global_spent_usd: round(global), max_user_spent_usd: round(maxUser) };
}

/**
 * Số job LLM đang chờ / chạy bị ảnh hưởng nếu hạn mức user là `limit`: của người đã chi tới mức đó hôm nay.
 * Dùng cho câu xác nhận khi hạ hạn mức.
 */
export async function llmJobsOverUserLimit(t: DbLike, limit: number): Promise<number> {
  const over =
    limit === 0
      ? sql`true`
      : sql`coalesce((select sum(${usageLedger.costUsd}) from ${usageLedger} where ${usageLedger.userId} = ${jobs.userId} and ${usageLedger.createdAt} >= ${dayStart}), 0) >= ${limit}`;
  const [row] = await t
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(inArray(jobs.status, ["queued", "running"]), llmJobSql, over));
  return row?.n ?? 0;
}

/** Số job LLM đang chờ / chạy (bị `paused_budget` khi vượt ngân sách ngày toàn cục). */
export async function activeLlmJobs(t: DbLike): Promise<number> {
  const [row] = await t
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(inArray(jobs.status, ["queued", "running"]), llmJobSql));
  return row?.n ?? 0;
}
