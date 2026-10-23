/**
 * Dispatcher Modal (red team #9), chạy trong `mtl-jobs` mỗi 5s khi DISPATCHER_ENABLED. Chỉ phục vụ workspace
 * `worker_mode='modal'` (worker Mac phục vụ workspace `mac`, không ưu tiên chéo):
 *   age  = oldest_queued_age(modal, loại job claim được, trừ LLM khi breaker bật)
 *   open = dispatch pending (< 120s) + active
 *   age > 0  và open = 0                         và ngân sách ok → 1 dispatch + POST /drain (HMAC)
 *   age > 60s và không còn pending, active < max và ngân sách ok → thêm 1 dispatch
 *   pending > 120s không có claim → no_claim, cảnh báo, backoff 1'→2'→4'→8'→15' (cả khi container thoát mà
 *   không chạy job nào); phiên có việc → hết backoff
 * Không bắn thêm khi còn dispatch pending → cold start dài (≤ 120s) chỉ tốn 1 container.
 */
import { createHmac } from "node:crypto";
import { type DbLike, dispatches, jobs, runtimeFlags, workspaceSettings } from "@mtl/db";
import type { JobType, SessionsEndRequest } from "@mtl/shared";
import { and, eq, inArray, lt, lte, not, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import { budgetStatus } from "../billing/budget.ts";
import { recordDispatchUsage } from "../billing/ledger.ts";
import { GPU_USD_PER_S } from "../billing/prices.ts";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { sendAlert } from "../lib/alert.ts";
import { isLlmPaused } from "./breaker.ts";
import { JobHttpError } from "./errors.ts";
import { llmJobSql } from "./llm-job-filter.ts";

export const DISPATCH_INTERVAL_MS = 5_000;
export const DISPATCH_PENDING_S = 120;
export const SCALE_UP_AGE_S = 60;
export const NO_CLAIM_BACKOFF_S = [60, 120, 240, 480, 900] as const;
/** Bù trễ khi so lifetime container báo với thời gian từ lúc tạo dispatch. */
const LIFETIME_SLACK_S = 30;
const BACKOFF_KEY = "dispatch_backoff";
/** Phiên bận ít hơn mức này coi như không làm gì. */
const MIN_BUSY_S = 1;

const tx = <R>(fn: (t: DbLike) => Promise<R>) => db.transaction((t) => fn(t as unknown as DbLike));

/** Gọi Modal /drain cho 1 dispatch; ném lỗi khi không 2xx (dispatch → no_claim + backoff). */
export type DrainCall = (dispatchId: string) => Promise<void>;

export function signDrainBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export const callModalDrain: DrainCall = async (dispatchId) => {
  if (!env.MODAL_DRAIN_URL || !env.MODAL_DRAIN_SECRET) throw new Error("MODAL_DRAIN_URL/SECRET chưa cấu hình");
  // ts trong body đã ký → phía Modal từ chối request cũ hơn 5' (chống phát lại).
  const body = JSON.stringify({ dispatch_id: dispatchId, ts: Math.floor(Date.now() / 1000) });
  const res = await fetch(env.MODAL_DRAIN_URL, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "x-mtl-signature": signDrainBody(body, env.MODAL_DRAIN_SECRET) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`modal drain ${res.status}`);
};

/** Tuổi (giây) job đủ điều kiện claim lâu nhất; null khi không có. `mode` bỏ trống = mọi workspace. */
export async function oldestQueuedAgeS(
  t: DbLike,
  opts: { mode?: "mac" | "modal"; types?: readonly JobType[]; where?: SQL } = {},
): Promise<number | null> {
  const [row] = await t
    .select({ age: sql<string | null>`extract(epoch from now() - min(${jobs.runAfter}))` })
    .from(jobs)
    .leftJoin(workspaceSettings, eq(workspaceSettings.workspaceId, jobs.workspaceId))
    .where(
      and(
        eq(jobs.status, "queued"),
        lte(jobs.runAfter, sql`now()`),
        opts.types ? inArray(jobs.type, [...opts.types]) : undefined,
        opts.mode ? sql`coalesce(${workspaceSettings.workerMode}, 'mac') = ${opts.mode}` : undefined,
        opts.where,
      ),
    );
  return row?.age == null ? null : Number(row.age);
}

/**
 * Container claim kèm dispatch_id → dispatch active (kể cả no_claim đến muộn). Trả id để gắn vào job; null khi
 * id không tồn tại (không gắn FK lỗi). Backoff chỉ xoá khi một phiên thật sự làm việc (endSession).
 */
export async function markDispatchClaimed(t: DbLike, id: string): Promise<string | null> {
  const [d] = await t.select().from(dispatches).where(eq(dispatches.id, id)).for("update");
  if (!d) return null;
  if (d.status === "pending" || d.status === "no_claim") {
    await t
      .update(dispatches)
      .set({ status: "active", firstClaimAt: sql`coalesce(${dispatches.firstClaimAt}, now())`, endedAt: null })
      .where(eq(dispatches.id, id));
  }
  return d.id;
}

async function bumpBackoff(t: DbLike, by: number) {
  const [row] = await t.select().from(runtimeFlags).where(eq(runtimeFlags.key, BACKOFF_KEY)).for("update");
  const level = Math.min(((row?.value.level as number | undefined) ?? 0) + by, NO_CLAIM_BACKOFF_S.length);
  const until = new Date(Date.now() + (NO_CLAIM_BACKOFF_S[level - 1] ?? 0) * 1000);
  await t
    .insert(runtimeFlags)
    .values({ key: BACKOFF_KEY, value: { level }, until })
    .onConflictDoUpdate({ target: runtimeFlags.key, set: { value: { level }, until, updatedAt: sql`now()` } });
  return { level, until };
}

type Decision = { created: string | null; noClaim: string[]; reason: string };

async function decide(t: DbLike): Promise<Decision> {
  const noClaim = (
    await t
      .update(dispatches)
      .set({ status: "no_claim", endedAt: sql`now()`, note: `no claim within ${DISPATCH_PENDING_S}s` })
      .where(
        and(
          eq(dispatches.status, "pending"),
          lt(dispatches.createdAt, sql`now() - make_interval(secs => ${DISPATCH_PENDING_S})`),
        ),
      )
      .returning({ id: dispatches.id })
  ).map((r) => r.id);
  if (noClaim.length) await bumpBackoff(t, noClaim.length);
  const done = (reason: string): Decision => ({ created: null, noClaim, reason });

  const [bo] = await t.select().from(runtimeFlags).where(eq(runtimeFlags.key, BACKOFF_KEY)).limit(1);
  if (bo?.until && bo.until > new Date()) return done("backoff");
  if ((await budgetStatus(t)).exceeded) return done("budget");

  // Breaker LLM bật: vẫn dispatch cho job không gọi LLM (gồm page.prepare OCR local) — cùng điều kiện với claim.
  const age = await oldestQueuedAgeS(t, { mode: "modal", where: (await isLlmPaused(t)) ? not(llmJobSql) : undefined });
  if (age === null) return done("idle");
  const open = await t
    .select({ status: dispatches.status, n: sql<number>`count(*)::int` })
    .from(dispatches)
    .where(inArray(dispatches.status, ["pending", "active"]))
    .groupBy(dispatches.status);
  const pending = open.find((r) => r.status === "pending")?.n ?? 0;
  const active = open.find((r) => r.status === "active")?.n ?? 0;
  const first = pending + active === 0;
  const scaleUp = age > SCALE_UP_AGE_S && pending === 0 && active < env.MODAL_MAX_CONTAINERS;
  if (!first && !scaleUp) return done("enough");
  const [d] = await t.insert(dispatches).values({}).returning({ id: dispatches.id });
  return { created: d?.id ?? null, noClaim, reason: first ? "first" : "scale_up" };
}

/** Một lượt dispatcher. Khoá advisory → 2 process mtl-jobs chạy nhầm cùng lúc vẫn không bắn trùng. */
export async function dispatchTick(call: DrainCall = callModalDrain): Promise<Decision> {
  const d = await tx(async (t) => {
    const [lock] = await t.execute<{ ok: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext('mtl_dispatcher')) as ok`,
    );
    if (!lock?.ok) return { created: null, noClaim: [], reason: "locked" } satisfies Decision;
    return decide(t);
  });
  for (const id of d.noClaim) {
    await sendAlert("Modal không claim", `dispatch ${id} chờ > ${DISPATCH_PENDING_S}s không có claim — backoff`);
  }
  if (d.created) {
    try {
      await call(d.created);
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500);
      await tx(async (t) => {
        await t
          .update(dispatches)
          .set({ status: "no_claim", endedAt: sql`now()`, note: `drain call failed: ${msg}` })
          .where(eq(dispatches.id, d.created as string));
        await bumpBackoff(t, 1);
      });
      await sendAlert("Gọi Modal thất bại", `dispatch ${d.created}: ${msg}`);
      return { ...d, reason: "call_failed" };
    }
  }
  return d;
}

/**
 * Container báo lúc thoát → dispatch ended + ledger `gpu_idle_seconds = lifetime − busy + scaledown` (chi phí nền
 * tảng; lifetime tính từ lúc process khởi động nên đã gồm nạp model).
 * Clamp: lifetime ≤ thời gian thực từ lúc tạo dispatch, busy ≤ lifetime. Báo lại → no-op.
 */
export async function endSession(req: z.infer<typeof SessionsEndRequest>) {
  return tx(async (t) => {
    const [d] = await t.select().from(dispatches).where(eq(dispatches.id, req.dispatch_id)).for("update");
    if (!d) throw new JobHttpError(404, "dispatch_not_found");
    if (d.status === "ended") return { ok: true, duplicate: true };
    const maxLifetime = (Date.now() - d.createdAt.getTime()) / 1000 + LIFETIME_SLACK_S;
    const lifetime = Math.min(req.lifetime_s, maxLifetime);
    const busy = Math.min(req.busy_s, lifetime);
    await t
      .update(dispatches)
      .set({ status: "ended", endedAt: sql`now()`, lifetimeS: lifetime, busyS: busy })
      .where(eq(dispatches.id, d.id));
    // Sau khi function trả về, Modal giữ container rỗi thêm scaledown_window (vẫn tính tiền) — container không tự
    // đo được phần này nên server cộng vào.
    const idle = lifetime - busy + env.MODAL_SCALEDOWN_S;
    await recordDispatchUsage(t, d.id, "gpu_idle_seconds", idle, GPU_USD_PER_S.modal);
    // Phiên không chạy job nào (hàng đợi có job container không nhận được, VD thiếu capability) → backoff như
    // no_claim, tránh vòng bắn container rỗng liên tục; phiên có việc → hết backoff.
    if (busy < MIN_BUSY_S) await bumpBackoff(t, 1);
    else await t.delete(runtimeFlags).where(eq(runtimeFlags.key, BACKOFF_KEY));
    return { ok: true, duplicate: false };
  });
}

/**
 * Container bị kill không kịp báo: dispatch active quá timeout Modal (max_lifetime) + scaledown → ended,
 * ước lượng GPU rỗi = scaledown_window (đuôi chờ trước khi Modal tắt container). Trả số dispatch xử lý.
 */
export async function reapDispatches(): Promise<number> {
  const horizonS = env.MODAL_MAX_LIFETIME_S + env.MODAL_SCALEDOWN_S + LIFETIME_SLACK_S;
  return tx(async (t) => {
    const stale = await t
      .update(dispatches)
      .set({ status: "ended", endedAt: sql`now()`, note: "killed_estimated" })
      .where(
        and(
          eq(dispatches.status, "active"),
          lt(
            sql`coalesce(${dispatches.firstClaimAt}, ${dispatches.createdAt})`,
            sql`now() - make_interval(secs => ${horizonS})`,
          ),
        ),
      )
      .returning({ id: dispatches.id });
    for (const { id } of stale) {
      await recordDispatchUsage(t, id, "gpu_idle_seconds", env.MODAL_SCALEDOWN_S, GPU_USD_PER_S.modal);
    }
    return stale.length;
  });
}
