/**
 * Hạn mức USD/ngày + đăng ký chỉ cấu hình trong `.env`: API admin không còn đọc/ghi hạn mức, `/healthz.signup` và
 * hạn mức user theo env lúc chạy.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { env } from "../src/env.ts";
import { call, seedAdmin, seedUser } from "./helpers.ts";

type Admin = Awaited<ReturnType<typeof seedAdmin>>;
let admin: Admin;
const initial = { user: env.USER_DAILY_USD, global: env.GLOBAL_DAILY_USD, signup: env.SIGNUP_ENABLED };

// seedAdmin đặt ADMIN_EMAILS và isolate-queue khôi phục sau mỗi ca → đặt lại trước mỗi request.
const api = (path: string, method = "GET", body?: unknown) => {
  if (!env.ADMIN_EMAILS.includes(admin.email)) env.ADMIN_EMAILS.push(admin.email);
  return call(`/api/admin${path}`, { method, cookie: admin.cookie, body });
};
const healthzSignup = async () => ((await (await call("/healthz")).json()) as { signup: string | null }).signup;

beforeAll(async () => {
  admin = await seedAdmin("admin-limits");
});
afterEach(() => {
  env.USER_DAILY_USD = initial.user;
  env.GLOBAL_DAILY_USD = initial.global;
  env.SIGNUP_ENABLED = initial.signup;
});

describe("admin settings without limits", () => {
  it("GET /settings returns only pipeline + slots; PUT /settings/limits no longer exists", async () => {
    const res = await api("/settings");
    expect(res.status).toBe(200);
    expect(Object.keys((await res.json()) as object).sort()).toEqual(["pipeline", "slots"]);
    const put = await api("/settings/limits", "PUT", { user_daily_usd: 1, global_daily_usd: 1, signup_enabled: true });
    expect(put.status).toBe(404);
  });
});

describe("limits follow env at runtime", () => {
  it("user daily limit from env blocks LLM endpoints and shows in /api/me", async () => {
    const S = await seedUser("lim-env");
    env.USER_DAILY_USD = 0;
    const res = await call(`/api/chapters/${S.chapterId}/retry-failed`, { method: "POST", cookie: S.cookie, body: {} });
    expect(res.status).toBe(402);
    const me = (await (await call("/api/me", { cookie: S.cookie })).json()) as { quota: { limit_usd: number } };
    expect(me.quota.limit_usd).toBe(0);
  });

  it("/healthz.signup is open only when SIGNUP_ENABLED and both limits are set", async () => {
    env.SIGNUP_ENABLED = true;
    env.USER_DAILY_USD = 1;
    env.GLOBAL_DAILY_USD = undefined;
    expect(await healthzSignup()).toBe("closed");
    env.GLOBAL_DAILY_USD = 10;
    expect(await healthzSignup()).toBe("open");
    env.SIGNUP_ENABLED = false;
    expect(await healthzSignup()).toBe("closed");
  });
});
