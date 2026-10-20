/**
 * Trạng thái cho `/healthz`: DB, MinIO, runner (`mtl-jobs` ghi runtime_flags.runner_heartbeat mỗi 30s).
 * `oldest_queued_age_s` để infra/alert.sh cảnh báo hàng đợi cũ > 15' (không ảnh hưởng ok/fail).
 */
import { runtimeFlags } from "@mtl/db";
import { eq, sql } from "drizzle-orm";
import { db } from "../db.ts";
import { oldestQueuedAgeS } from "../jobs/dispatcher.ts";
import { bucketReachable } from "../storage.ts";

/** 3 nhịp reaper (30s) — runner chết/treo lâu hơn coi là hỏng. */
export const RUNNER_STALE_S = 90;

export type Health = {
  ok: boolean;
  db: boolean;
  storage: boolean;
  runner: boolean;
  oldest_queued_age_s: number | null;
};

async function check<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function checkHealth(): Promise<Health> {
  const [dbOk, storage] = await Promise.all([check(() => db.execute(sql`select 1`)), bucketReachable()]);
  let runner = false;
  let age: number | null = null;
  if (dbOk) {
    const beat = await check(() => db.select().from(runtimeFlags).where(eq(runtimeFlags.key, "runner_heartbeat")));
    const at = beat?.[0]?.updatedAt;
    runner = !!at && Date.now() - at.getTime() < RUNNER_STALE_S * 1000;
    age = await check(() => oldestQueuedAgeS(db));
  }
  const ok = !!dbOk && storage && runner;
  return { ok, db: !!dbOk, storage, runner, oldest_queued_age_s: age === null ? null : Math.round(age) };
}
