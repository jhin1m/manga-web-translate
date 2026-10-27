/**
 * Process nền tách khỏi API (systemd `mtl-jobs`): API restart không làm ngừng reaper và ngược lại.
 * - 30s: reaper lease + dispatch bị kill, ngân sách (mở lại `paused_budget`, cảnh báo 50/80/100%), job LLM chờ của
 *   người vượt hạn mức ngày → failed (khi chỉ có Modal, job đó không bị claim nên không qua nhánh fail ở claim),
 *   `runtime_flags.runner_heartbeat` cho healthz;
 * - 5s (DISPATCHER_ENABLED): dispatcher Modal.
 * Chạy: pnpm --filter @mtl/api jobs
 */
import { type DbLike, runtimeFlags } from "@mtl/db";
import { sql } from "drizzle-orm";
import { budgetStatus, checkBudgetAlerts, resumeBudgetPaused } from "../billing/budget.ts";
import { closeDb, db } from "../db.ts";
import { env } from "../env.ts";
import { DISPATCH_INTERVAL_MS, dispatchTick, reapDispatches } from "./dispatcher.ts";
import { failOverQuotaQueued } from "./queue.ts";
import { reapExpiredLeases } from "./reaper.ts";

export const REAPER_INTERVAL_MS = 30_000;

async function beat() {
  await db
    .insert(runtimeFlags)
    .values({ key: "runner_heartbeat", value: { pid: process.pid } })
    .onConflictDoUpdate({ target: runtimeFlags.key, set: { value: { pid: process.pid }, updatedAt: sql`now()` } });
}

/** Hết vượt ngưỡng (ngày/tháng mới hoặc owner nâng ngưỡng) → job `paused_budget` chạy lại; gửi cảnh báo mốc. */
export async function maintainBudget(): Promise<{ resumed: number; alerts: string[] }> {
  return db.transaction(async (raw) => {
    const t = raw as unknown as DbLike;
    const s = await budgetStatus(t);
    const resumed = s.exceeded ? 0 : await resumeBudgetPaused(t);
    return { resumed, alerts: await checkBudgetAlerts(t, s) };
  });
}

async function tick() {
  const steps: [string, () => Promise<string | null>][] = [
    [
      "reaper",
      async () => {
        const r = await reapExpiredLeases();
        return r.requeued || r.failed ? `requeued=${r.requeued} failed=${r.failed}` : null;
      },
    ],
    ["dispatch-reaper", async () => ((await reapDispatches()) ? "estimated killed dispatches" : null)],
    [
      "quota",
      async () => {
        const n = await db.transaction((t) => failOverQuotaQueued(t as unknown as DbLike));
        return n ? `failed=${n}` : null;
      },
    ],
    [
      "budget",
      async () => {
        const b = await maintainBudget();
        return b.resumed || b.alerts.length ? `resumed=${b.resumed} alerts=${b.alerts.join(",")}` : null;
      },
    ],
  ];
  // Mỗi bước độc lập: 1 bước lỗi không chặn heartbeat (healthz chỉ báo hỏng khi cả process ngừng).
  for (const [name, fn] of steps) {
    try {
      const msg = await fn();
      if (msg) console.info(`[${name}] ${msg}`);
    } catch (err) {
      console.error(`[${name}] tick failed`, err);
    }
  }
  try {
    await beat();
  } catch (err) {
    console.error("[runner] heartbeat failed", err);
  }
}

async function dispatchLoopTick() {
  try {
    const d = await dispatchTick();
    if (d.created || d.noClaim.length) console.info(`[dispatcher] ${d.reason} created=${d.created ?? "-"}`);
  } catch (err) {
    console.error("[dispatcher] tick failed", err);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let stopping = false;
  const timers = new Map<string, NodeJS.Timeout>();
  const every = (name: string, ms: number, fn: () => Promise<void>) => {
    const loop = async () => {
      await fn();
      if (!stopping) timers.set(name, setTimeout(loop, ms));
    };
    void loop();
  };
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      stopping = true;
      for (const t of timers.values()) clearTimeout(t);
      void closeDb().finally(() => process.exit(0));
    });
  }
  console.info(
    `[runner] reaper every ${REAPER_INTERVAL_MS / 1000}s, dispatcher ${env.DISPATCHER_ENABLED ? "on" : "off"}`,
  );
  every("reaper", REAPER_INTERVAL_MS, tick);
  if (env.DISPATCHER_ENABLED) every("dispatcher", DISPATCH_INTERVAL_MS, dispatchLoopTick);
}
