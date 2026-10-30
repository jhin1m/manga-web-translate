/**
 * Đăng ký email/mật khẩu theo cờ SIGNUP_ENABLED: tắt → chặn trước bước tra email (email mới / đã có cùng phản hồi),
 * bật → tạo được, email trùng không lộ (không 422 riêng), rate limit 5 lần/giờ/IP; `createUser` (script) luôn tạo
 * được; SIGNUP_ENABLED=true thiếu hạn mức → env không parse.
 */
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/auth.ts";
import { env, parseEnv } from "../src/env.ts";
import { createUser } from "../src/lib/create-user.ts";
import { PASSWORD, signIn, uniq } from "./helpers.ts";

type AuthInstance = ReturnType<typeof createAuth>;

function signUp(a: AuthInstance, email: string, ip = "203.0.113.1") {
  return a.handler(
    new Request(`${env.BETTER_AUTH_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: env.WEB_ORIGIN, "x-real-ip": ip },
      body: JSON.stringify({ email, password: PASSWORD, name: "Lan" }),
    }),
  );
}

const outcome = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

describe("sign-up disabled (default)", () => {
  const off = createAuth({ signupEnabled: false });

  it("blocks new and existing emails with the same response (no account enumeration)", async () => {
    const existing = `${uniq("exists")}@example.com`;
    await createUser({ email: existing, name: "Có sẵn", password: PASSWORD });
    const fresh = await outcome(await signUp(off, `${uniq("new")}@example.com`));
    const dup = await outcome(await signUp(off, existing));
    expect(fresh.status).toBe(400);
    expect(fresh.body.code).toBe("EMAIL_PASSWORD_SIGN_UP_DISABLED");
    expect(dup).toEqual(fresh);
  });

  it("the server script still creates accounts that can sign in", async () => {
    expect(env.SIGNUP_ENABLED).toBe(false);
    const email = `${uniq("script")}@example.com`;
    await createUser({ email, name: "Script", password: PASSWORD });
    await expect(signIn(email)).resolves.toContain("session_token");
    await expect(createUser({ email, name: "Lại", password: PASSWORD })).rejects.toThrow(/đã tồn tại/);
  });
});

describe("sign-up enabled", () => {
  it("creates the user without a session; a duplicate email gets the same shape (no 422)", async () => {
    const on = createAuth({ signupEnabled: true });
    const email = `${uniq("open")}@example.com`;
    const first = await signUp(on, email, "203.0.113.10");
    expect(first.status).toBe(200);
    expect(first.headers.getSetCookie()).toEqual([]);
    const created = (await first.json()) as { token: string | null; user: { email: string } };
    expect(created).toMatchObject({ token: null, user: { email } });
    await expect(signIn(email)).resolves.toContain("session_token");

    const dup = await signUp(on, email, "203.0.113.11");
    expect(dup.status).toBe(200);
    expect((await dup.json()) as { token: null }).toMatchObject({ token: null, user: { email } });
  });

  it("rate limits /sign-up/email to 5 per hour per IP", async () => {
    const on = createAuth({ signupEnabled: true });
    const ip = "198.51.100.7";
    for (let i = 0; i < 5; i++) expect((await signUp(on, `${uniq("rl")}@example.com`, ip)).status).toBe(200);
    expect((await signUp(on, `${uniq("rl")}@example.com`, ip)).status).toBe(429);
    // IP khác không bị ảnh hưởng.
    expect((await signUp(on, `${uniq("rl")}@example.com`, "198.51.100.8")).status).toBe(200);
  });

  it("never rate limits session reads, however often a page asks", async () => {
    const on = createAuth({ signupEnabled: true });
    const getSession = () =>
      on.handler(
        new Request(`${env.BETTER_AUTH_URL}/api/auth/get-session`, {
          headers: { origin: env.WEB_ORIGIN, "x-real-ip": "198.51.100.9" },
        }),
      );
    // Quá mức mặc định 100 lần / cửa sổ 10s của better-auth.
    const statuses = new Set<number>();
    for (let i = 0; i < 150; i++) statuses.add((await getSession()).status);
    expect([...statuses]).toEqual([200]);
  });
});

describe("env", () => {
  const { SIGNUP_ENABLED: _s, USER_DAILY_USD: _u, GLOBAL_DAILY_USD: _g, NODE_ENV: _n, ...base } = process.env;

  it("SIGNUP_ENABLED defaults to false; true requires GLOBAL_DAILY_USD and USER_DAILY_USD even without NODE_ENV", () => {
    expect(parseEnv(base).SIGNUP_ENABLED).toBe(false);
    expect(() => parseEnv({ ...base, SIGNUP_ENABLED: "true", GLOBAL_DAILY_USD: "10" })).toThrow(/USER_DAILY_USD/);
    expect(() => parseEnv({ ...base, SIGNUP_ENABLED: "true", USER_DAILY_USD: "1" })).toThrow(/GLOBAL_DAILY_USD/);
    const ok = parseEnv({ ...base, SIGNUP_ENABLED: "true", GLOBAL_DAILY_USD: "10", USER_DAILY_USD: "0" });
    expect(ok).toMatchObject({ SIGNUP_ENABLED: true, USER_DAILY_USD: 0, NODE_ENV: "development" });
  });
});
