/**
 * Dispatcher Modal: chỉ theo workspace `modal`, không bắn trùng khi còn dispatch pending (cold start dài),
 * no_claim + backoff, scale-up khi hàng đợi cũ, dừng khi hết ngân sách; sessions/end → gpu_idle_seconds
 * (chi phí nền tảng, khử trùng theo dispatch); reaper ước lượng container bị kill; /healthz.
 */
import { dispatches, jobs, runtimeFlags, usageLedger } from "@mtl/db";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GPU_USD_PER_S } from "../src/billing/prices.ts";
import { env } from "../src/env.ts";
import {
  DISPATCH_PENDING_S,
  type DrainCall,
  dispatchTick,
  NO_CLAIM_BACKOFF_S,
  reapDispatches,
  signDrainBody,
} from "../src/jobs/dispatcher.ts";
import { enqueueIngest, inJobTx } from "../src/jobs/enqueue.ts";
import { app, db, seedWorkspace } from "./helpers.ts";
import { addSources, type Claimed, claimJobs, setWorkerMode, VERSION, wcall, workerToken } from "./worker-helpers.ts";

const calls: string[] = [];
const fakeDrain: DrainCall = async (id) => {
  calls.push(id);
};

/** Bảng dispatch + hàng đợi là trạng thái toàn cục: job queued của file test trước không được làm nhiễu. */
async function resetGlobalState() {
  calls.length = 0;
  await db.update(jobs).set({ status: "cancelled" }).where(eq(jobs.status, "queued"));
  await db.delete(usageLedger).where(isNotNull(usageLedger.dispatchId));
  await db.delete(dispatches);
  await db
    .delete(runtimeFlags)
    .where(sql`${runtimeFlags.key} in ('dispatch_backoff', 'llm_paused', 'llm_errors', 'runner_heartbeat')`);
  env.GLOBAL_DAILY_USD = undefined;
  env.GLOBAL_MONTHLY_USD = undefined;
  env.MODAL_MAX_CONTAINERS = 2;
}

/** Workspace có 1 job chapter.ingest queued; mode quyết định worker nào phục vụ. */
async function queuedWorkspace(label: string, mode: "mac" | "modal") {
  const S = await seedWorkspace(label);
  await setWorkerMode(S.workspaceId, mode);
  await addSources(S.workspaceId, S.chapterId, 1);
  await inJobTx((tx) => enqueueIngest(tx, S.workspaceId, S.chapterId));
  return S;
}

const ageJobs = (s: number) =>
  db
    .update(jobs)
    .set({ runAfter: sql`now() - make_interval(secs => ${s})` })
    .where(eq(jobs.status, "queued"));
const ageDispatch = (id: string, s: number) =>
  db
    .update(dispatches)
    .set({ createdAt: sql`now() - make_interval(secs => ${s})` })
    .where(eq(dispatches.id, id));
const dispatchRow = async (id: string) => (await db.select().from(dispatches).where(eq(dispatches.id, id)))[0];

async function platformClaim(token: string, dispatchId: string | null) {
  const res = await wcall(token, "/claim", {
    worker_id: "modal-test",
    capabilities: ["chapter.ingest"],
    max: 1,
    pipeline_version: VERSION,
    dispatch_id: dispatchId,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { jobs: Claimed[] }).jobs;
}

beforeEach(resetGlobalState);
afterAll(resetGlobalState);

describe("dispatch decisions", () => {
  it("idle queue → no dispatch; mac-only queue → no dispatch", async () => {
    expect((await dispatchTick(fakeDrain)).reason).toBe("idle");
    await queuedWorkspace("dmaconly", "mac");
    expect((await dispatchTick(fakeDrain)).reason).toBe("idle");
    expect(calls).toEqual([]);
  });

  it("first job → exactly 1 dispatch; 90s cold start does not fire again", async () => {
    await queuedWorkspace("dfirst", "modal");
    const d = await dispatchTick(fakeDrain);
    expect(d.reason).toBe("first");
    expect(calls).toEqual([d.created]);
    // Cold start 90s: hàng đợi đã cũ > 60s nhưng dispatch còn pending → không bắn thêm.
    await ageDispatch(d.created as string, 90);
    await ageJobs(200);
    for (let i = 0; i < 3; i++) expect((await dispatchTick(fakeDrain)).created).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("pending > 120s without claim → no_claim + backoff 1' → 2'; productive session resets backoff", async () => {
    await queuedWorkspace("dnoclaim", "modal");
    const first = await dispatchTick(fakeDrain);
    await ageDispatch(first.created as string, DISPATCH_PENDING_S + 5);
    const t2 = await dispatchTick(fakeDrain);
    expect(t2.noClaim).toEqual([first.created]);
    expect(t2.reason).toBe("backoff");
    expect((await dispatchRow(first.created as string))?.status).toBe("no_claim");
    const [bo] = await db.select().from(runtimeFlags).where(eq(runtimeFlags.key, "dispatch_backoff"));
    expect(bo?.value.level).toBe(1);
    const waitS = ((bo?.until?.getTime() ?? 0) - Date.now()) / 1000;
    expect(waitS).toBeGreaterThan(NO_CLAIM_BACKOFF_S[0] - 5);
    expect(waitS).toBeLessThanOrEqual(NO_CLAIM_BACKOFF_S[0]);

    // Hết backoff → dispatch mới; lại không claim → level 2 (2').
    await db
      .update(runtimeFlags)
      .set({ until: sql`now() - interval '1 second'` })
      .where(eq(runtimeFlags.key, "dispatch_backoff"));
    const second = await dispatchTick(fakeDrain);
    expect(second.reason).toBe("first");
    await ageDispatch(second.created as string, DISPATCH_PENDING_S + 5);
    await dispatchTick(fakeDrain);
    const [bo2] = await db.select().from(runtimeFlags).where(eq(runtimeFlags.key, "dispatch_backoff"));
    expect(bo2?.value.level).toBe(2);

    // Container đến muộn vẫn claim được → dispatch active, job gắn dispatch_id; chạy việc xong → hết backoff.
    const platform = (await workerToken(null, "modal-late")).token;
    const [job] = await platformClaim(platform, second.created as string);
    expect(job).toBeDefined();
    expect((await dispatchRow(second.created as string))?.status).toBe("active");
    await ageDispatch(second.created as string, 300);
    const end = { dispatch_id: second.created, lifetime_s: 200, busy_s: 150 };
    expect((await wcall(platform, "/sessions/end", end)).status).toBe(200);
    expect(await db.select().from(runtimeFlags).where(eq(runtimeFlags.key, "dispatch_backoff"))).toEqual([]);
    const [jr] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, job?.id ?? ""));
    expect(jr?.dispatchId).toBe(second.created);
  });

  it("scale-up only when queue is old, nothing pending and active < max_containers", async () => {
    await queuedWorkspace("dscale1", "modal");
    await queuedWorkspace("dscale2", "modal");
    await queuedWorkspace("dscale3", "modal");
    const platform = (await workerToken(null, "modal-scale")).token;
    const a = await dispatchTick(fakeDrain);
    await platformClaim(platform, a.created as string); // active = 1
    expect((await dispatchTick(fakeDrain)).reason).toBe("enough"); // queue còn trẻ
    await ageJobs(61);
    const b = await dispatchTick(fakeDrain);
    expect(b.reason).toBe("scale_up");
    await platformClaim(platform, b.created as string); // active = 2 = max
    await ageJobs(300);
    expect((await dispatchTick(fakeDrain)).reason).toBe("enough");
    expect(calls).toHaveLength(2);
  });

  it("container that ends without running any job → backoff (no empty-container loop)", async () => {
    await queuedWorkspace("dempty", "modal");
    const platform = (await workerToken(null, "modal-empty")).token;
    const id = (await dispatchTick(fakeDrain)).created as string;
    await platformClaim(platform, id);
    await ageDispatch(id, 30);
    await wcall(platform, "/sessions/end", { dispatch_id: id, lifetime_s: 25, busy_s: 0 });
    // Job vẫn queued (VD container thiếu capability) nhưng không bắn container mới ngay.
    expect((await dispatchTick(fakeDrain)).reason).toBe("backoff");
    expect(calls).toHaveLength(1);
  });

  it("a Mac worker holding a lease in a mac workspace does not block modal dispatch", async () => {
    const mac = await queuedWorkspace("dmaclease", "mac");
    const macToken = (await workerToken(mac.workspaceId)).token;
    const [held] = await claimJobs(macToken, { caps: ["chapter.ingest"] });
    expect(held).toBeDefined();
    await queuedWorkspace("dmodalok", "modal");
    expect((await dispatchTick(fakeDrain)).reason).toBe("first");
  });

  it("budget exceeded → no dispatch; drain call failure → no_claim + backoff", async () => {
    await queuedWorkspace("dbudget", "modal");
    env.GLOBAL_DAILY_USD = 0;
    expect((await dispatchTick(fakeDrain)).reason).toBe("budget");
    env.GLOBAL_DAILY_USD = undefined;
    const d = await dispatchTick(async () => {
      throw new Error("modal drain 503");
    });
    expect(d.reason).toBe("call_failed");
    expect((await dispatchRow(d.created as string))?.status).toBe("no_claim");
    expect((await dispatchTick(fakeDrain)).reason).toBe("backoff");
  });

  it("platform claim with unknown dispatch_id is ignored (no FK error)", async () => {
    await queuedWorkspace("dunknown", "modal");
    const platform = (await workerToken(null, "modal-unknown")).token;
    const [j] = await platformClaim(platform, "00000000-0000-4000-8000-000000000000");
    const [row] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, j?.id ?? ""));
    expect(row?.dispatchId).toBeNull();
  });
});

describe("sessions/end + dispatch reaper", () => {
  it("workspace token → 403; platform → gpu_idle_seconds = lifetime − busy, clamped, deduped", async () => {
    await queuedWorkspace("dsess", "modal");
    const S = await seedWorkspace("dsess-ws");
    const wsToken = (await workerToken(S.workspaceId)).token;
    const platform = (await workerToken(null, "modal-sess")).token;
    const d = await dispatchTick(fakeDrain);
    const id = d.created as string;
    await ageDispatch(id, 100);
    await platformClaim(platform, id);

    const body = { dispatch_id: id, lifetime_s: 90, busy_s: 70 };
    expect((await wcall(wsToken, "/sessions/end", body)).status).toBe(403);
    const r1 = await wcall(platform, "/sessions/end", body);
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ ok: true, duplicate: false });
    const r2 = await wcall(platform, "/sessions/end", { ...body, lifetime_s: 500 });
    expect(await r2.json()).toEqual({ ok: true, duplicate: true });

    const rows = await db.select().from(usageLedger).where(eq(usageLedger.dispatchId, id));
    expect(rows).toHaveLength(1);
    const idle = 20 + env.MODAL_SCALEDOWN_S;
    expect(rows[0]).toMatchObject({ kind: "gpu_idle_seconds", workspaceId: null, jobId: null, quantity: idle });
    expect(rows[0]?.costUsd).toBeCloseTo(idle * GPU_USD_PER_S.modal, 9);
    expect(await dispatchRow(id)).toMatchObject({ status: "ended", lifetimeS: 90, busyS: 70 });

    // Dispatch mới tạo báo lifetime 10000s → clamp về thời gian thực (+30s).
    await db.update(jobs).set({ status: "cancelled" }).where(eq(jobs.status, "queued"));
    await queuedWorkspace("dsess2", "modal");
    const d2 = (await dispatchTick(fakeDrain)).created as string;
    await wcall(platform, "/sessions/end", { dispatch_id: d2, lifetime_s: 10_000, busy_s: 0 });
    const [r] = await db.select().from(usageLedger).where(eq(usageLedger.dispatchId, d2));
    expect(r?.quantity).toBeLessThanOrEqual(35 + env.MODAL_SCALEDOWN_S);
    expect(
      (await wcall(platform, "/sessions/end", { ...body, dispatch_id: "00000000-0000-4000-8000-000000000000" })).status,
    ).toBe(404);
  });

  it("killed container (active past max lifetime) → ended with scaledown estimate, then late report is a no-op", async () => {
    await queuedWorkspace("dkill", "modal");
    const platform = (await workerToken(null, "modal-kill")).token;
    const id = (await dispatchTick(fakeDrain)).created as string;
    await platformClaim(platform, id);
    expect(await reapDispatches()).toBe(0);
    const old = env.MODAL_MAX_LIFETIME_S + env.MODAL_SCALEDOWN_S + 60;
    await db
      .update(dispatches)
      .set({
        firstClaimAt: sql`now() - make_interval(secs => ${old})`,
        createdAt: sql`now() - make_interval(secs => ${old})`,
      })
      .where(eq(dispatches.id, id));
    expect(await reapDispatches()).toBe(1);
    expect(await dispatchRow(id)).toMatchObject({ status: "ended", note: "killed_estimated" });
    const rows = await db
      .select()
      .from(usageLedger)
      .where(and(eq(usageLedger.dispatchId, id), eq(usageLedger.kind, "gpu_idle_seconds")));
    expect(rows.map((r) => r.quantity)).toEqual([env.MODAL_SCALEDOWN_S]);
    const late = await wcall(platform, "/sessions/end", { dispatch_id: id, lifetime_s: 50, busy_s: 10 });
    expect(await late.json()).toEqual({ ok: true, duplicate: true });
  });
});

describe("HMAC + healthz", () => {
  it("signs drain body with a stable HMAC-SHA256 (same vector as worker/tests)", () => {
    expect(signDrainBody('{"dispatch_id":"d","ts":1}', "k".repeat(32))).toBe(
      "sha256=4dd07b0b40061fb0bc562c83812fc4484d4e9e9f1b9ce66f2c7d1c4ed4520a20",
    );
  });

  it("/healthz: 503 without runner heartbeat, 200 when DB + MinIO + runner are fine", async () => {
    const down = await app.request("/healthz");
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ ok: false, db: true, storage: true, runner: false });
    await db.insert(runtimeFlags).values({ key: "runner_heartbeat", value: { pid: 1 } });
    const up = await app.request("/healthz");
    expect(up.status).toBe(200);
    const body = (await up.json()) as { ok: boolean; oldest_queued_age_s: number | null };
    expect(body.ok).toBe(true);
    expect(body.oldest_queued_age_s).toBeNull();
    await db
      .update(runtimeFlags)
      .set({ updatedAt: sql`now() - interval '5 minutes'` })
      .where(eq(runtimeFlags.key, "runner_heartbeat"));
    expect((await app.request("/healthz")).status).toBe(503);
  });
});
