/**
 * Hạn mức USD/ngày + đăng ký chỉnh trên UI admin: có hiệu lực ở request kế tiếp (không dựng lại app), DB `null` = theo
 * env, hạ xuống dưới số đã chi hôm nay cần xác nhận, không bật được đăng ký khi thiếu hạn mức, `/healthz.signup` đúng.
 */
import { jobs, systemSettings, usageLedger } from "@mtl/db";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { quotaFailMessage } from "../src/billing/user-quota.ts";
import { env } from "../src/env.ts";
import { enqueueIngest, inJobTx } from "../src/jobs/enqueue.ts";
import { maintainBudget } from "../src/jobs/runner.ts";
import { call, db, seedAdmin, seedUser } from "./helpers.ts";
import { cancelActiveJobs } from "./isolate-queue.ts";
import {
  addSources,
  type Claimed,
  claimJobs,
  doIngest,
  fence,
  jobRow,
  usage,
  wcall,
  workerToken,
} from "./worker-helpers.ts";

type Admin = Awaited<ReturnType<typeof seedAdmin>>;
type Settings = {
  limits: { user_daily_usd: number | null; global_daily_usd: number | null; signup_enabled: boolean | null };
  effective: { user_daily_usd: number | null; global_daily_usd: number | null; signup_enabled: boolean };
  env: Settings["limits"];
  today: { global_spent_usd: number; max_user_spent_usd: number };
};
let admin: Admin;
const initial = { user: env.USER_DAILY_USD, global: env.GLOBAL_DAILY_USD, signup: env.SIGNUP_ENABLED };

// seedAdmin đặt ADMIN_EMAILS và isolate-queue khôi phục sau mỗi ca → đặt lại trước mỗi request.
const api = (path: string, method = "GET", body?: unknown) => {
  if (!env.ADMIN_EMAILS.includes(admin.email)) env.ADMIN_EMAILS.push(admin.email);
  return call(`/api/admin${path}`, { method, cookie: admin.cookie, body });
};
const putLimits = (body: Record<string, unknown>) =>
  api("/settings/limits", "PUT", { user_daily_usd: null, global_daily_usd: null, signup_enabled: null, ...body });
const getSettings = async () => (await (await api("/settings")).json()) as Settings;
const healthzSignup = async () => ((await (await call("/healthz")).json()) as { signup: string | null }).signup;

const spend = (userId: string, usd: number) =>
  db.insert(usageLedger).values({ userId, kind: "gpu_seconds", quantity: 1, unitCostUsd: usd, costUsd: usd });

async function ingested(label: string) {
  const S = await seedUser(label);
  const mac = (await workerToken("mac")).token;
  await addSources(S.userId, S.chapterId, 1);
  await inJobTx((tx) => enqueueIngest(tx, S.userId, S.chapterId));
  const [ij] = await claimJobs(mac, { caps: ["chapter.ingest"] });
  expect((await doIngest(mac, ij as Claimed)).status).toBe(200);
  return { S, mac };
}

const prepareJobs = (chapterId: string) =>
  db
    .select()
    .from(jobs)
    .where(and(eq(jobs.chapterId, chapterId), eq(jobs.type, "page.prepare")));

beforeAll(async () => {
  admin = await seedAdmin("admin-limits");
});
beforeEach(async () => {
  await cancelActiveJobs();
  env.USER_DAILY_USD = undefined;
  env.GLOBAL_DAILY_USD = undefined;
  env.SIGNUP_ENABLED = false;
});
afterEach(async () => {
  env.USER_DAILY_USD = initial.user;
  env.GLOBAL_DAILY_USD = initial.global;
  env.SIGNUP_ENABLED = initial.signup;
  await db.delete(systemSettings);
});

describe("settings view", () => {
  it("shows stored values (null = env) next to the effective ones and today's spend", async () => {
    env.USER_DAILY_USD = 3;
    const S = await seedUser("lim-view");
    await spend(S.userId, 1.25);
    const s = await getSettings();
    expect(s.limits).toEqual({ user_daily_usd: null, global_daily_usd: null, signup_enabled: null });
    expect(s.effective).toEqual({
      user_daily_usd: 3,
      global_daily_usd: null,
      signup_enabled: false,
      signup_open: false,
    });
    expect(s.env).toEqual({ user_daily_usd: 3, global_daily_usd: null, signup_enabled: false });
    expect(s.today.max_user_spent_usd).toBeGreaterThanOrEqual(1.25);
    expect(s.today.global_spent_usd).toBeGreaterThanOrEqual(s.today.max_user_spent_usd);

    expect((await putLimits({ user_daily_usd: 7.5 })).status).toBe(200);
    const after = await getSettings();
    expect(after.limits.user_daily_usd).toBe(7.5);
    expect(after.effective.user_daily_usd).toBe(7.5);
  });

  it("rejects negative / malformed values and non-admins", async () => {
    expect((await putLimits({ user_daily_usd: -1 })).status).toBe(400);
    expect((await putLimits({ global_daily_usd: "5" })).status).toBe(400);
    const plain = await seedUser("lim-plain");
    const res = await call("/api/admin/settings/limits", {
      method: "PUT",
      cookie: plain.cookie,
      body: { user_daily_usd: 1, global_daily_usd: null, signup_enabled: null },
    });
    expect(res.status).toBe(403);
  });
});

describe("user daily limit from the database applies immediately", () => {
  it("endpoint 402, claim fails the job with the DB limit in the message; null falls back to env", async () => {
    const { S } = await ingested("lim-user");
    await spend(S.userId, 1.5);
    const retry = () =>
      call(`/api/chapters/${S.chapterId}/retry-failed`, { method: "POST", cookie: S.cookie, body: {} });

    expect((await retry()).status).toBe(202);
    await cancelActiveJobs();
    expect((await putLimits({ user_daily_usd: 1, confirm: true })).status).toBe(200);
    const blocked = await retry();
    expect(blocked.status).toBe(402);
    expect(await blocked.json()).toMatchObject({ error: "quota_exceeded", spent_usd: 1.5, limit_usd: 1 });
    const me = (await (await call("/api/me", { cookie: S.cookie })).json()) as { quota: { limit_usd: number } };
    expect(me.quota.limit_usd).toBe(1);
    expect(await inJobTx((tx) => quotaFailMessage(tx))).toBe("quota_exceeded: vượt hạn mức $1/ngày");

    // null → theo env (không đặt) → thông ngay.
    expect((await putLimits({ user_daily_usd: null })).status).toBe(200);
    expect((await retry()).status).toBe(202);

    // Claim: job LLM đang chờ của user vượt hạn mức DB → failed quota_exceeded.
    await cancelActiveJobs();
    const queued = await ingested("lim-claim");
    await spend(queued.S.userId, 2);
    expect((await putLimits({ user_daily_usd: 1, confirm: true })).status).toBe(200);
    expect(await claimJobs(queued.mac, { caps: ["page.prepare"], max: 8 })).toEqual([]);
    const [job] = await prepareJobs(queued.S.chapterId);
    expect(job).toMatchObject({ status: "failed" });
    expect(job?.error).toBe("quota_exceeded: vượt hạn mức $1/ngày");
  });

  it("heartbeat stops a running job when the DB limit is lowered under the user's spend", async () => {
    const { S, mac } = await ingested("lim-hb");
    const [j] = (await claimJobs(mac, { caps: ["page.prepare"] })) as Claimed[];
    if (!j) throw new Error("no job");
    await spend(S.userId, 1);
    expect((await putLimits({ user_daily_usd: 0.5, confirm: true })).status).toBe(200);
    const hb = await wcall(mac, `/jobs/${j.id}/heartbeat`, {
      ...fence(j),
      progress: 0.5,
      stage: null,
      usage: usage(1),
    });
    expect(((await hb.json()) as { stop: string }).stop).toBe("cancel");
    expect((await jobRow(j.id)).error).toMatch(/^quota_exceeded/);
  });

  it("limit 0 blocks everything, even an empty ledger (needs confirm)", async () => {
    const S = await seedUser("lim-zero");
    expect((await putLimits({ user_daily_usd: 0 })).status).toBe(409);
    expect((await putLimits({ user_daily_usd: 0, confirm: true })).status).toBe(200);
    const res = await call(`/api/chapters/${S.chapterId}/retry-failed`, { method: "POST", cookie: S.cookie, body: {} });
    expect(res.status).toBe(402);
  });
});

describe("global daily budget from the database", () => {
  it("limit 0 pauses paid jobs at claim; clearing it resumes them without a restart", async () => {
    const { S, mac } = await ingested("lim-global");
    expect((await putLimits({ global_daily_usd: 0, confirm: true })).status).toBe(200);
    expect(await claimJobs(mac, { caps: ["page.prepare"], max: 8 })).toEqual([]);
    expect((await prepareJobs(S.chapterId)).map((j) => j.status)).toEqual(["paused_budget"]);

    expect((await putLimits({ global_daily_usd: null })).status).toBe(200);
    await maintainBudget();
    expect((await prepareJobs(S.chapterId)).map((j) => j.status)).toEqual(["queued"]);
  });
});

describe("lowering a limit below today's spend", () => {
  it("user limit: 409 confirm_required with numbers and affected jobs, nothing saved; confirm saves; raising needs none", async () => {
    const { S } = await ingested("lim-confirm");
    await spend(S.userId, 2);
    const res = await putLimits({ user_daily_usd: 1 });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ error: "confirm_required", user_over: true, global_over: false, user_jobs: 1 });
    expect(body.max_user_spent_usd as number).toBeGreaterThanOrEqual(2);
    expect((await getSettings()).limits.user_daily_usd).toBeNull();

    expect((await putLimits({ user_daily_usd: 1, confirm: true })).status).toBe(200);
    expect((await getSettings()).limits.user_daily_usd).toBe(1);
    // Nâng lên hoặc giữ nguyên mức đã vượt (đổi trường khác) không cần xác nhận.
    expect((await putLimits({ user_daily_usd: 1, signup_enabled: false })).status).toBe(200);
    expect((await putLimits({ user_daily_usd: 50 })).status).toBe(200);
  });

  it("global budget: 409 below today's total; confirm saves", async () => {
    const S = await seedUser("lim-gconfirm");
    await spend(S.userId, 2);
    const res = await putLimits({ global_daily_usd: 1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "confirm_required", user_over: false, global_over: true });
    expect((await getSettings()).limits.global_daily_usd).toBeNull();
    expect((await putLimits({ global_daily_usd: 1, confirm: true })).status).toBe(200);
    expect((await putLimits({ global_daily_usd: 1e6 })).status).toBe(200);
  });
});

describe("sign-up toggle", () => {
  it("cannot be switched on without both effective limits; env counts; removing a limit while on is refused", async () => {
    const missing = await putLimits({ signup_enabled: true, user_daily_usd: 1e6 });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ error: "limits_required" });
    expect((await getSettings()).limits.signup_enabled).toBeNull();

    env.GLOBAL_DAILY_USD = 100;
    expect((await putLimits({ signup_enabled: true, user_daily_usd: 1e6 })).status).toBe(200);
    expect(await healthzSignup()).toBe("open");

    // Xoá hạn mức user (không còn env) khi đang bật → 409.
    expect((await putLimits({ signup_enabled: true, user_daily_usd: null })).status).toBe(409);
    expect(await healthzSignup()).toBe("open");

    // Tắt luôn được; healthz đổi theo.
    expect((await putLimits({ signup_enabled: false, user_daily_usd: 1e6 })).status).toBe(200);
    expect(await healthzSignup()).toBe("closed");
  });

  it("DB null follows env.SIGNUP_ENABLED; an env-on sign-up with env limits reports open", async () => {
    env.USER_DAILY_USD = 1;
    env.GLOBAL_DAILY_USD = 10;
    expect(await healthzSignup()).toBe("closed");
    env.SIGNUP_ENABLED = true;
    expect(await healthzSignup()).toBe("open");
    expect((await putLimits({ signup_enabled: false })).status).toBe(200);
    expect(await healthzSignup()).toBe("closed");
  });
});
