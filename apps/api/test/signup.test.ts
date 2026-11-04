/**
 * Đăng ký email/mật khẩu theo cờ SIGNUP_ENABLED: tắt → chặn trước bước tra email (email mới / đã có cùng phản hồi),
 * bật → tạo được, email trùng không lộ (không 422 riêng), rate limit 5 lần/giờ/IP; `createUser` (script) luôn tạo
 * được; SIGNUP_ENABLED=true thiếu hạn mức → env không parse.
 */
import { systemSettings, user } from "@mtl/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth.ts";
import { env, parseEnv } from "../src/env.ts";
import { createUser } from "../src/lib/create-user.ts";
import { db, PASSWORD, signIn, uniq } from "./helpers.ts";

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
  const off = createAuth({ isSignupEnabled: async () => false });

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
    const on = createAuth({ isSignupEnabled: async () => true });
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

  it("always rejects ADMIN_EMAILS addresses (any case/spacing) without creating a user; others still register", async () => {
    const on = createAuth({ isSignupEnabled: async () => true });
    const email = `${uniq("boss")}@example.com`;
    env.ADMIN_EMAILS.push(`  ${email.toUpperCase()} `);
    for (const attempt of [email, email.toUpperCase(), ` ${email} `]) {
      const res = await outcome(await signUp(on, attempt, "203.0.113.20"));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("EMAIL_PASSWORD_SIGN_UP_DISABLED");
    }
    await expect(signIn(email)).rejects.toThrow();
    const rows = await db.select().from(user).where(eq(user.email, email));
    expect(rows).toEqual([]);

    const ok = await signUp(on, `${uniq("regular")}@example.com`, "203.0.113.21");
    expect(ok.status).toBe(200);
    // Script tạo tài khoản không qua HTTP nên vẫn tạo được admin.
    await expect(createUser({ email, name: "Admin", password: PASSWORD })).resolves.toBeDefined();
    await expect(signIn(email)).resolves.toContain("session_token");
  });

  it("rate limits /sign-up/email to 5 per hour per IP", async () => {
    const on = createAuth({ isSignupEnabled: async () => true, rateLimitEnabled: true });
    const ip = "198.51.100.7";
    for (let i = 0; i < 5; i++) expect((await signUp(on, `${uniq("rl")}@example.com`, ip)).status).toBe(200);
    expect((await signUp(on, `${uniq("rl")}@example.com`, ip)).status).toBe(429);
    // IP khác không bị ảnh hưởng.
    expect((await signUp(on, `${uniq("rl")}@example.com`, "198.51.100.8")).status).toBe(200);
  });

  it("never rate limits session reads, however often a page asks", async () => {
    const on = createAuth({ isSignupEnabled: async () => true, rateLimitEnabled: true });
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

describe("sign-up toggled at runtime", () => {
  afterEach(async () => {
    await db.delete(systemSettings);
  });

  const setSettings = (v: {
    userDailyUsd?: string | null;
    globalDailyUsd?: string | null;
    signupEnabled?: boolean | null;
  }) =>
    db
      .insert(systemSettings)
      .values({ id: 1, ...v })
      .onConflictDoUpdate({ target: systemSettings.id, set: v });

  it("the default instance reads system_settings per request: open with both limits, closed the moment it is switched off", async () => {
    const auth = createAuth();
    await setSettings({ userDailyUsd: "1", globalDailyUsd: "10", signupEnabled: true });
    const open = await signUp(auth, `${uniq("rt")}@example.com`, "203.0.113.30");
    expect(open.status).toBe(200);

    await setSettings({ signupEnabled: false });
    const existing = `${uniq("rt-dup")}@example.com`;
    await createUser({ email: existing, name: "Có sẵn", password: PASSWORD });
    const fresh = await outcome(await signUp(auth, `${uniq("rt")}@example.com`, "203.0.113.31"));
    const dup = await outcome(await signUp(auth, existing, "203.0.113.32"));
    expect(fresh).toMatchObject({ status: 400, body: { code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" } });
    expect(dup).toEqual(fresh);
  });

  it("treats a missing effective limit as closed even when switched on; env is the fallback for null", async () => {
    const auth = createAuth();
    const prev = { signup: env.SIGNUP_ENABLED, user: env.USER_DAILY_USD, global: env.GLOBAL_DAILY_USD };
    try {
      await setSettings({ userDailyUsd: "1", globalDailyUsd: null, signupEnabled: true });
      expect((await signUp(auth, `${uniq("rt")}@example.com`, "203.0.113.33")).status).toBe(400);
      env.GLOBAL_DAILY_USD = 10;
      expect((await signUp(auth, `${uniq("rt")}@example.com`, "203.0.113.34")).status).toBe(200);
      // DB null → theo env.
      await setSettings({ userDailyUsd: null, globalDailyUsd: null, signupEnabled: null });
      env.SIGNUP_ENABLED = false;
      env.USER_DAILY_USD = 1;
      expect((await signUp(auth, `${uniq("rt")}@example.com`, "203.0.113.35")).status).toBe(400);
      env.SIGNUP_ENABLED = true;
      expect((await signUp(auth, `${uniq("rt")}@example.com`, "203.0.113.36")).status).toBe(200);
    } finally {
      env.SIGNUP_ENABLED = prev.signup;
      env.USER_DAILY_USD = prev.user;
      env.GLOBAL_DAILY_USD = prev.global;
    }
  });

  it("an admin email is rejected even while sign-up is open at runtime", async () => {
    const auth = createAuth();
    await setSettings({ userDailyUsd: "1", globalDailyUsd: "10", signupEnabled: true });
    const email = `${uniq("boss")}@example.com`;
    env.ADMIN_EMAILS.push(email);
    expect((await signUp(auth, email, "203.0.113.37")).status).toBe(400);
    expect(await db.select().from(user).where(eq(user.email, email))).toEqual([]);
  });

  it("fails closed when the setting cannot be read: 500 and no user is created", async () => {
    const auth = createAuth({
      isSignupEnabled: async () => {
        throw new Error("db unreachable");
      },
    });
    const email = `${uniq("fc")}@example.com`;
    const res = await signUp(auth, email, "203.0.113.38");
    expect(res.status).toBe(500);
    expect(await db.select().from(user).where(eq(user.email, email))).toEqual([]);
  });

  it("rate limit (when on) answers 429 after 5 attempts per IP even while sign-up is closed", async () => {
    const auth = createAuth({ isSignupEnabled: async () => false, rateLimitEnabled: true });
    const ip = "198.51.100.40";
    for (let i = 0; i < 5; i++) expect((await signUp(auth, `${uniq("rl")}@example.com`, ip)).status).toBe(400);
    expect((await signUp(auth, `${uniq("rl")}@example.com`, ip)).status).toBe(429);
  });

  it("the default instance has rate limiting off under NODE_ENV=test", async () => {
    const auth = createAuth({ isSignupEnabled: async () => false });
    const ip = "198.51.100.41";
    const statuses = new Set<number>();
    for (let i = 0; i < 8; i++) statuses.add((await signUp(auth, `${uniq("rl")}@example.com`, ip)).status);
    expect([...statuses]).toEqual([400]);
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
