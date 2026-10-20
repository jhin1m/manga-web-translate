/**
 * Owner mở lại job `paused_budget` → `queued` ngay (không chờ sang ngày/tháng mới).
 *   pnpm budget-resume              # in trạng thái ngân sách; chỉ mở lại khi đã hết vượt ngưỡng
 *   pnpm budget-resume --force      # mở lại kể cả khi còn vượt (claim kế tiếp sẽ dừng lại ngay — dùng sau khi
 *                                   # đã nâng GLOBAL_DAILY_USD/GLOBAL_MONTHLY_USD và restart mtl-api + mtl-jobs)
 */
import { parseArgs } from "node:util";
import { type BudgetWindow, budgetStatus, resumeBudgetPaused } from "../apps/api/src/billing/budget.ts";
import { closeDb, db } from "../apps/api/src/db.ts";

type DbLike = Parameters<typeof budgetStatus>[0];

const { values } = parseArgs({ options: { force: { type: "boolean", default: false } } });

const fmt = (name: string, w: BudgetWindow) =>
  `${name} ${w.period}: $${w.spentUsd.toFixed(4)} / ${w.limitUsd === null ? "∞" : `$${w.limitUsd.toFixed(2)}`} (${Math.round(w.ratio * 100)}%)`;

try {
  const out = await db.transaction(async (raw) => {
    const t = raw as unknown as DbLike;
    const s = await budgetStatus(t);
    console.info(fmt("ngày", s.daily));
    console.info(fmt("tháng", s.monthly));
    if (s.exceeded && !values.force) return null;
    return resumeBudgetPaused(t);
  });
  if (out === null) {
    console.error("vẫn vượt ngưỡng → không mở lại. Nâng ngưỡng trong .env, restart, hoặc dùng --force.");
    process.exitCode = 1;
  } else {
    console.info(`đã mở lại ${out} job paused_budget → queued`);
  }
} finally {
  await closeDb();
}
