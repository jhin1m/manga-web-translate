/** Quyền admin theo ADMIN_EMAILS: mọi route /api/admin/* (quét router thật) 401 khi chưa đăng nhập, 403 với user thường. */
import { beforeAll, describe, expect, it } from "vitest";
import { env } from "../src/env.ts";
import { adminApi } from "../src/routes/admin.ts";
import { call, seedAdmin, seedUser } from "./helpers.ts";

type Seed = Awaited<ReturnType<typeof seedUser>>;
let plain: Seed;

const adminRoutes = () => {
  const seen = new Set<string>();
  for (const r of adminApi().routes) if (r.method !== "ALL") seen.add(`${r.method} ${r.path}`);
  return [...seen].sort();
};

const hit = (route: string, cookie?: string) => {
  const [method = "GET", path = ""] = route.split(" ");
  return call(`/api/admin${path}`, { method, cookie, body: method === "GET" ? undefined : {} });
};

beforeAll(async () => {
  plain = await seedUser("admin-access-plain");
});

describe("admin access", () => {
  it("discovers the admin routes", () => {
    expect(adminRoutes()).toEqual(expect.arrayContaining(["GET /settings", "PUT /settings/pipeline"]));
  });

  it("no session → 401 on every admin route (also for a bogus cookie)", async () => {
    for (const route of adminRoutes()) {
      for (const cookie of [undefined, "better-auth.session_token=bogus"]) {
        expect((await hit(route, cookie)).status, route).toBe(401);
      }
    }
  });

  it("a signed-in non-admin gets 403 forbidden on every admin route", async () => {
    for (const route of adminRoutes()) {
      const res = await hit(route, plain.cookie);
      expect(res.status, route).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
  });

  it("admin passes; email match is trimmed and case-insensitive on both sides", async () => {
    const u = await seedUser("admin-access-norm");
    env.ADMIN_EMAILS.push(`  ${u.email.toUpperCase()} `);
    expect((await call("/api/admin/settings", { cookie: u.cookie })).status).toBe(200);
    const me = (await (await call("/api/me", { cookie: u.cookie })).json()) as { is_admin: boolean };
    expect(me.is_admin).toBe(true);
  });

  it("/api/me reports is_admin and no longer carries pipeline settings", async () => {
    const admin = await seedAdmin("admin-access-me");
    const asAdmin = (await (await call("/api/me", { cookie: admin.cookie })).json()) as Record<string, unknown>;
    expect(asAdmin.is_admin).toBe(true);
    expect(asAdmin).not.toHaveProperty("settings");
    const asPlain = (await (await call("/api/me", { cookie: plain.cookie })).json()) as Record<string, unknown>;
    expect(asPlain.is_admin).toBe(false);
  });

  it("admin emails do not leak between cases", async () => {
    expect(env.ADMIN_EMAILS).toEqual([]);
    expect((await call("/api/admin/settings", { cookie: plain.cookie })).status).toBe(403);
  });
});
