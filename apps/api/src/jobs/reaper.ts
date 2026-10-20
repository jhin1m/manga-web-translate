/**
 * Reaper: lease hết hạn (worker chết/mất mạng) → `queued` (attempts giữ nguyên, lease_token xoá → worker cũ
 * sống lại bị 409) hoặc `failed` khi đã hết attempts; cập nhật page/chapter như fail thường.
 */
import { type DbLike, jobs } from "@mtl/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db.ts";
import { requeue, terminal } from "./queue.ts";

const BATCH = 100;

/** Một lượt quét; trả số job đã xử lý. */
export async function reapExpiredLeases(): Promise<{ requeued: number; failed: number }> {
  const counts = { requeued: 0, failed: 0 };
  await db.transaction(async (raw) => {
    const t = raw as unknown as DbLike;
    const expired = await t
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "running"), lt(jobs.leaseExpiresAt, sql`now()`)))
      .limit(BATCH)
      .for("update", { skipLocked: true });
    for (const job of expired) {
      if (job.attempts >= job.maxAttempts) {
        await terminal(t, job, "failed", "internal", "lease expired (worker mất kết nối hoặc bị kill)");
        counts.failed++;
      } else {
        await requeue(t, job, {
          delayS: 0,
          refundAttempt: false,
          providerRetry: false,
          errorClass: "internal",
          message: "lease expired",
        });
        counts.requeued++;
      }
    }
  });
  return counts;
}
