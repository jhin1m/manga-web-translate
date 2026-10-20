/**
 * Process nền tách khỏi API (systemd `mtl-jobs`, Phase 7): reaper 30s/lần + ghi `runtime_flags.runner_heartbeat`
 * cho healthz. Chạy: pnpm --filter @mtl/api jobs
 */
import { runtimeFlags } from "@mtl/db";
import { sql } from "drizzle-orm";
import { closeDb, db } from "../db.ts";
import { reapExpiredLeases } from "./reaper.ts";

export const REAPER_INTERVAL_MS = 30_000;

async function beat() {
  await db
    .insert(runtimeFlags)
    .values({ key: "runner_heartbeat", value: { pid: process.pid } })
    .onConflictDoUpdate({ target: runtimeFlags.key, set: { value: { pid: process.pid }, updatedAt: sql`now()` } });
}

async function tick() {
  try {
    const r = await reapExpiredLeases();
    if (r.requeued || r.failed) console.info(`[reaper] requeued=${r.requeued} failed=${r.failed}`);
    await beat();
  } catch (err) {
    console.error("[reaper] tick failed", err);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  const loop = async () => {
    await tick();
    if (!stopping) timer = setTimeout(loop, REAPER_INTERVAL_MS);
  };
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      stopping = true;
      clearTimeout(timer);
      void closeDb().finally(() => process.exit(0));
    });
  }
  console.info(`[runner] reaper every ${REAPER_INTERVAL_MS / 1000}s`);
  void loop();
}
