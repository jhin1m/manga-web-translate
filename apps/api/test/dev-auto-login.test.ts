/** Dev auto-login: 3 lớp chặn production (boot lỗi, điều kiện bật, route không mount) + đăng nhập thật ở dev. */
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { devAutoLoginEnabled, env, parseEnv } from "../src/env.ts";
import { PASSWORD, seedWorkspace } from "./helpers.ts";

// Bỏ DEV_AUTO_LOGIN_* thật (`.env` dev nạp vào process.env) → mỗi case chỉ thấy đúng biến nó đặt.
const { DEV_AUTO_LOGIN_EMAIL: _email, DEV_AUTO_LOGIN_PASSWORD: _password, ...realEnv } = process.env;
const base = { ...realEnv, GLOBAL_DAILY_USD: "10", GLOBAL_MONTHLY_USD: "100" };
const dev = {
  ...env,
  NODE_ENV: "development" as const,
  BETTER_AUTH_URL: "http://localhost:5180",
  DEV_AUTO_LOGIN_EMAIL: "dev@example.com",
  DEV_AUTO_LOGIN_PASSWORD: "dev-password-123",
};
const post = (app: ReturnType<typeof createApp>) =>
  app.request("/api/dev/auto-login", { method: "POST", headers: { origin: env.WEB_ORIGIN } });

describe("dev auto-login", () => {
  it("refuses to boot in production with DEV_AUTO_LOGIN_* set", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production", DEV_AUTO_LOGIN_EMAIL: "a@x.io" })).toThrow(
      /DEV_AUTO_LOGIN_/,
    );
    expect(() => parseEnv({ ...base, NODE_ENV: "production", DEV_AUTO_LOGIN_PASSWORD: "dev-password-123" })).toThrow(
      /DEV_AUTO_LOGIN_/,
    );
    expect(() => parseEnv({ ...base, NODE_ENV: "production", DEV_AUTO_LOGIN_EMAIL: "" })).not.toThrow();
  });

  it("is enabled only for development + credentials + localhost", () => {
    expect(devAutoLoginEnabled(dev)).toBe(true);
    expect(devAutoLoginEnabled({ ...dev, BETTER_AUTH_URL: "http://127.0.0.1:5180" })).toBe(true);
    expect(devAutoLoginEnabled({ ...dev, NODE_ENV: "test" })).toBe(false);
    expect(devAutoLoginEnabled({ ...dev, NODE_ENV: "production" })).toBe(false);
    expect(devAutoLoginEnabled({ ...dev, DEV_AUTO_LOGIN_EMAIL: undefined })).toBe(false);
    expect(devAutoLoginEnabled({ ...dev, DEV_AUTO_LOGIN_PASSWORD: undefined })).toBe(false);
    expect(devAutoLoginEnabled({ ...dev, BETTER_AUTH_URL: "https://app.example.com" })).toBe(false);
  });

  it("does not mount the route by default (NODE_ENV=test)", async () => {
    expect((await post(createApp())).status).toBe(404);
  });

  it("signs in the configured user with a 7-day session cookie", async () => {
    const { email } = await seedWorkspace("devlogin");
    const res = await post(createApp({ devAutoLogin: { email, password: PASSWORD } }));
    expect(res.status, await res.clone().text()).toBe(200);
    const cookie = res.headers.getSetCookie().find((c) => c.includes("better-auth.session_token="));
    expect(cookie).toMatch(/Max-Age=604800/);
  });
});
