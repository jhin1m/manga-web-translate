/**
 * Trạng thái cho `/healthz` (và `/readyz` = phần không gồm runner): DB, storage (bucket S3 hoặc thư mục disk driver), runner (`mtl-jobs` ghi runtime_flags.runner_heartbeat mỗi 30s).
 * `oldest_queued_age_s` để infra/alert.sh cảnh báo hàng đợi cũ > 15' (không ảnh hưởng ok/fail); job của tài khoản bị khoá không tính (không ai claim, sẽ chờ mãi).
 */
import { runtimeFlags } from "@mtl/db";
import { eq, sql } from "drizzle-orm";
import { notDisabledOwnerSql } from "../billing/user-quota.ts";
import { db } from "../db.ts";
import { oldestQueuedAgeS } from "../jobs/dispatcher.ts";
import { bucketReachable } from "../storage.ts";
import { isSignupOpen } from "./system-settings.ts";

/** 3 nhịp reaper (30s) — runner chết/treo lâu hơn coi là hỏng. */
export const RUNNER_STALE_S = 90;

export type Health = {
  ok: boolean;
  db: boolean;
  storage: boolean;
  runner: boolean;
  oldest_queued_age_s: number | null;
  /** Đăng ký công khai đang mở thật sự (bật + đủ hạn mức); null = không đọc được DB. smoke.sh kiểm theo giá trị này. */
  signup: "open" | "closed" | null;
};

async function check<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export type Ready = { ok: boolean; db: boolean; storage: boolean };

/** DB + storage, KHÔNG xét runner — healthcheck của app (compose chờ app ready rồi mới chạy `jobs` = runner). */
export async function checkReady(): Promise<Ready> {
  const [dbOk, storage] = await Promise.all([check(() => db.execute(sql`select 1`)), bucketReachable()]);
  return { ok: !!dbOk && storage, db: !!dbOk, storage };
}

export async function checkHealth(): Promise<Health> {
  const { db: dbOk, storage } = await checkReady();
  let runner = false;
  let age: number | null = null;
  let signup: Health["signup"] = null;
  if (dbOk) {
    const beat = await check(() => db.select().from(runtimeFlags).where(eq(runtimeFlags.key, "runner_heartbeat")));
    const at = beat?.[0]?.updatedAt;
    runner = !!at && Date.now() - at.getTime() < RUNNER_STALE_S * 1000;
    age = await check(() => oldestQueuedAgeS(db, { where: notDisabledOwnerSql }));
    const open = await check(() => isSignupOpen(db));
    signup = open === null ? null : open ? "open" : "closed";
  }
  const ok = dbOk && storage && runner;
  return { ok, db: dbOk, storage, runner, oldest_queued_age_s: age === null ? null : Math.round(age), signup };
}
