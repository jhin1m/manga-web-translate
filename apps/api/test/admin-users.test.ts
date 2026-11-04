/**
 * Người dùng (admin): danh sách + chi phí theo ledger (ngày UTC / 30 ngày), khoá / mở. Khoá → phiên cũ 401, đăng nhập
 * lại 403 USER_DISABLED, phiên sót lại 403 user_disabled, job của họ không được claim; không khoá được admin / chính mình.
 */
import { jobs, usageLedger, user } from "@mtl/db";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../src/env.ts";
import { enqueueIngest, inJobTx } from "../src/jobs/enqueue.ts";
import { createUser } from "../src/lib/create-user.ts";
import { call, db, PASSWORD, seedAdmin, seedUser, signIn, uniq } from "./helpers.ts";
import { cancelActiveJobs } from "./isolate-queue.ts";
import { addSources, claimJobs, workerToken } from "./worker-helpers.ts";

type Row = {
  id: string;
  email: string;
  name: string;
  created_at: string;
  disabled_at: string | null;
  is_admin: boolean;
  cost_today_usd: number;
  cost_30d_usd: number;
};
let admin: Awaited<ReturnType<typeof seedAdmin>>;

// seedAdmin đặt ADMIN_EMAILS và isolate-queue khôi phục sau mỗi ca → đặt lại trước mỗi request.
const api = (path: string, method = "GET", body?: unknown) => {
  if (!env.ADMIN_EMAILS.includes(admin.email)) env.ADMIN_EMAILS.push(admin.email);
  return call(`/api/admin${path}`, { method, cookie: admin.cookie, body });
};
const list = async (q = "") => (await (await api(`/users?q=${encodeURIComponent(q)}`)).json()) as Row[];
const disable = (id: string) => api(`/users/${id}/disable`, "POST", {});
const enable = (id: string) => api(`/users/${id}/enable`, "POST", {});
const HOUR = 3_600_000;
const ledger = (userId: string, usd: number, hoursAgo: number) =>
  db.insert(usageLedger).values({
    userId,
    kind: "gpu_seconds",
    quantity: 1,
    unitCostUsd: usd,
    costUsd: usd,
    createdAt: new Date(Date.now() - hoursAgo * HOUR),
  });

beforeAll(async () => {
  admin = await seedAdmin("admin-users");
});
beforeEach(cancelActiveJobs);

describe("users list", () => {
  it("returns cost today / 30 days from the ledger (UTC) and flags admins", async () => {
    const u = await seedUser("users-cost");
    await db.delete(usageLedger).where(eq(usageLedger.userId, u.userId));
    await ledger(u.userId, 1, 0); // hôm nay
    await ledger(u.userId, 2, 25); // hôm qua: chỉ vào 30 ngày (luôn trước 00:00 UTC hôm nay)
    await ledger(u.userId, 4, 31 * 24); // ngoài 30 ngày
    const rows = await list(u.email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: u.userId,
      email: u.email,
      disabled_at: null,
      is_admin: false,
      cost_today_usd: 1,
      cost_30d_usd: 3,
    });
    const me = (await list(admin.email))[0];
    expect(me).toMatchObject({ is_admin: true, cost_today_usd: 0, cost_30d_usd: 0 });
  });

  it("filters by email or name literally (% and _ are escaped), newest first", async () => {
    const tag = uniq("zq");
    const a = await createUser({ email: `${tag}-a@example.com`, name: `Ten%${tag}`, password: PASSWORD });
    const b = await createUser({ email: `${tag}-b@example.com`, name: `Ten_${tag}`, password: PASSWORD });
    expect((await list(`${tag}-a`)).map((r) => r.id)).toEqual([a.userId]);
    expect((await list(`n%${tag}`)).map((r) => r.id)).toEqual([a.userId]);
    expect((await list(`n_${tag}`)).map((r) => r.id)).toEqual([b.userId]);
    expect((await list(tag)).map((r) => r.id)).toEqual([b.userId, a.userId]);
    expect((await list("%")).every((r) => r.email.includes("%") || r.name.includes("%"))).toBe(true);
  });
});

describe("disable / enable", () => {
  it("disable: old cookie 401, correct password 403 USER_DISABLED; enable: signs in again", async () => {
    const u = await seedUser("users-disable");
    expect((await call("/api/me", { cookie: u.cookie })).status).toBe(200);
    expect((await disable(u.userId)).status).toBe(200);
    expect((await call("/api/me", { cookie: u.cookie })).status).toBe(401);

    const res = await call("/api/auth/sign-in/email", { method: "POST", body: { email: u.email, password: PASSWORD } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("USER_DISABLED");
    expect((await list(u.email))[0]?.disabled_at).not.toBeNull();

    expect((await enable(u.userId)).status).toBe(200);
    expect((await list(u.email))[0]?.disabled_at).toBeNull();
    const again = await signIn(u.email);
    expect((await call("/api/me", { cookie: again })).status).toBe(200);
  });

  it("disabling again keeps the original disabled_at", async () => {
    const u = await seedUser("users-redisable");
    await disable(u.userId);
    const first = (await list(u.email))[0]?.disabled_at;
    await new Promise((r) => setTimeout(r, 20));
    expect((await disable(u.userId)).status).toBe(200);
    expect((await list(u.email))[0]?.disabled_at).toBe(first);
  });

  it("wrong password for a disabled user stays the generic sign-in failure (no account state leak)", async () => {
    const u = await seedUser("users-leak");
    await disable(u.userId);
    const res = await call("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: u.email, password: "nope-nope-nope" },
    });
    expect(res.status).toBe(401);
  });

  it("refuses to disable self or any ADMIN_EMAILS account (case-insensitive); unknown id → 404", async () => {
    expect(((await (await disable(admin.userId)).json()) as { error: string }).error).toBe("cannot_disable_admin");
    expect((await disable(admin.userId)).status).toBe(409);
    const other = await seedUser("users-other-admin");
    env.ADMIN_EMAILS.push(`  ${other.email.toUpperCase()} `);
    expect((await disable(other.userId)).status).toBe(409);
    const [row] = await db.select({ d: user.disabledAt }).from(user).where(eq(user.id, other.userId));
    expect(row?.d).toBeNull();
    expect((await disable("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await disable("not-a-uuid")).status).toBe(404);
    expect((await enable("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("a session that survives the flag (race) is rejected by requireUser with 403 user_disabled", async () => {
    const u = await seedUser("users-race");
    await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, u.userId));
    const res = await call("/api/me", { cookie: u.cookie });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("user_disabled");
  });

  it("createUser still works with the session hook installed (creates no session)", async () => {
    const email = `${uniq("users-script")}@example.com`;
    await expect(createUser({ email, name: "script", password: PASSWORD })).resolves.toHaveProperty("userId");
    expect(await signIn(email)).toContain("=");
  });
});

describe("claim skips jobs of disabled users", () => {
  it("queued job of a disabled user is not claimed, other users' jobs are; enabling lets it run", async () => {
    const mac = (await workerToken("mac")).token;
    const A = await seedUser("users-claim-a");
    const B = await seedUser("users-claim-b");
    for (const S of [A, B]) {
      await addSources(S.userId, S.chapterId, 1);
      await inJobTx((tx) => enqueueIngest(tx, S.userId, S.chapterId));
    }
    await disable(A.userId);
    const got = await claimJobs(mac, { caps: ["chapter.ingest"], max: 8 });
    const owners = await Promise.all(
      got.map(async (j) => (await db.select().from(jobs).where(eq(jobs.id, j.id)))[0]?.userId),
    );
    expect(owners).toEqual([B.userId]);
    const [aJob] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, A.userId), eq(jobs.type, "chapter.ingest")));
    expect(aJob?.status).toBe("queued");

    // Modal chỉ khác Mac ở vị ngữ hạn mức: job của chủ bị khoá cũng không được nhận.
    const modal = (await workerToken("modal", "modal-disabled")).token;
    const viaModal = await claimJobs(modal, { caps: ["chapter.ingest"], max: 8 });
    expect(viaModal.map((j) => j.id)).not.toContain(aJob?.id);

    await enable(A.userId);
    const after = await claimJobs(mac, { caps: ["chapter.ingest"], max: 8 });
    expect(after.map((j) => j.id)).toEqual([aJob?.id]);
  });
});
