/**
 * Kill-switch ngân sách toàn cục (red team #14): tổng `usage_ledger.cost_usd` (server tính, gồm chi phí nền tảng
 * user_id null) theo ngày/tháng UTC so với GLOBAL_DAILY_USD / GLOBAL_MONTHLY_USD.
 * - claim: vượt → job tốn tiền đang `queued` chuyển `paused_budget`, claim không trả loại đó (Mac lẫn Modal);
 * - heartbeat: job tốn tiền đang chạy → `paused_budget` + `stop: "paused_budget"` (không tính attempt);
 * - mtl-jobs: hết vượt (sang ngày/tháng mới hoặc nâng ngưỡng) → `paused_budget → queued`; cảnh báo 50/80/100%.
 */
import { type DbLike, jobs, runtimeFlags, usageLedger } from "@mtl/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { env } from "../env.ts";
import { llmJobSql } from "../jobs/llm-job-filter.ts";
import { sendAlert } from "../lib/alert.ts";

export type BudgetWindow = { spentUsd: number; limitUsd: number | null; ratio: number; period: string };
export type BudgetStatus = { daily: BudgetWindow; monthly: BudgetWindow; exceeded: boolean };

export const BUDGET_ALERT_LEVELS = [0.5, 0.8, 1] as const;
const ALERT_KEY = "budget_alert";

function budgetWindow(spentUsd: number, limitUsd: number | undefined, period: string): BudgetWindow {
  const limit = limitUsd ?? null;
  // Ngưỡng 0 = tắt hẳn job tốn tiền (rollback khẩn) → coi như đã đầy.
  const ratio = limit === null ? 0 : limit === 0 ? 1 : spentUsd / limit;
  return { spentUsd, limitUsd: limit, ratio, period };
}

export async function budgetStatus(t: DbLike): Promise<BudgetStatus> {
  const monthStart = sql`date_trunc('month', now() at time zone 'utc') at time zone 'utc'`;
  const dayStart = sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;
  const [row] = await t
    .select({
      day: sql<string>`coalesce(sum(${usageLedger.costUsd}) filter (where ${usageLedger.createdAt} >= ${dayStart}), 0)`,
      month: sql<string>`coalesce(sum(${usageLedger.costUsd}), 0)`,
      dayKey: sql<string>`to_char(now() at time zone 'utc', 'YYYY-MM-DD')`,
      monthKey: sql<string>`to_char(now() at time zone 'utc', 'YYYY-MM')`,
    })
    .from(usageLedger)
    .where(gte(usageLedger.createdAt, monthStart));
  const daily = budgetWindow(Number(row?.day ?? 0), env.GLOBAL_DAILY_USD, row?.dayKey ?? "");
  const monthly = budgetWindow(Number(row?.month ?? 0), env.GLOBAL_MONTHLY_USD, row?.monthKey ?? "");
  return { daily, monthly, exceeded: daily.ratio >= 1 || monthly.ratio >= 1 };
}

/** Job tốn tiền đang chờ → `paused_budget` (bỏ qua dòng worker khác đang khoá). Trả số job. */
export async function pauseQueuedPaidJobs(t: DbLike): Promise<number> {
  const locked = t
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.status, "queued"), llmJobSql))
    .for("update", { skipLocked: true });
  const rows = await t
    .update(jobs)
    .set({ status: "paused_budget" })
    .where(inArray(jobs.id, locked))
    .returning({ id: jobs.id });
  return rows.length;
}

/** `paused_budget → queued` (chạy ngay). Trả số job. */
export async function resumeBudgetPaused(t: DbLike): Promise<number> {
  const rows = await t
    .update(jobs)
    .set({ status: "queued", runAfter: sql`now()` })
    .where(eq(jobs.status, "paused_budget"))
    .returning({ id: jobs.id });
  return rows.length;
}

type AlertState = Partial<Record<"daily" | "monthly", { period: string; level: number }>>;

/** Cảnh báo khi vượt mốc 50/80/100% lần đầu trong kỳ (trạng thái lưu runtime_flags, không báo lặp). */
export async function checkBudgetAlerts(t: DbLike, s: BudgetStatus): Promise<string[]> {
  const [row] = await t.select().from(runtimeFlags).where(eq(runtimeFlags.key, ALERT_KEY)).limit(1);
  const state = (row?.value ?? {}) as AlertState;
  const sent: string[] = [];
  for (const name of ["daily", "monthly"] as const) {
    const w = s[name];
    if (w.limitUsd === null) continue;
    const level = [...BUDGET_ALERT_LEVELS].reverse().find((l) => w.ratio >= l);
    if (level === undefined) continue;
    const prev = state[name];
    if (prev && prev.period === w.period && prev.level >= level) continue;
    state[name] = { period: w.period, level };
    const pct = Math.round(level * 100);
    sent.push(`${name}:${pct}`);
    await sendAlert(
      `Ngân sách ${name === "daily" ? "ngày" : "tháng"} ${pct}%`,
      `${w.period}: $${w.spentUsd.toFixed(2)} / $${w.limitUsd.toFixed(2)}` +
        (level >= 1 ? " — job tốn tiền đã dừng (paused_budget)" : ""),
      level >= 1 ? "urgent" : "high",
    );
  }
  if (sent.length) {
    await t
      .insert(runtimeFlags)
      .values({ key: ALERT_KEY, value: state })
      .onConflictDoUpdate({ target: runtimeFlags.key, set: { value: state, updatedAt: sql`now()` } });
  }
  return sent;
}
