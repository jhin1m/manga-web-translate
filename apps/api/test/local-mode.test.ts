/**
 * Chế độ local (MTL_LOCAL_MODE) trên Postgres test: không đăng nhập (user local là admin), không mount better-auth,
 * `/api/config` public, local-guard bật, token worker ở file đối chiếu DB, backup pg_dump trước migrate.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workerTokens } from "@mtl/db";
import { testDatabaseUrl } from "@mtl/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { db } from "../src/db.ts";
import { env } from "../src/env.ts";
import { authenticateWorker, hashWorkerToken, revokeWorkerToken } from "../src/lib/worker-token.ts";
import { backupBeforeMigrate } from "../src/local/boot-backup.ts";
import { ensureLocalUser, LOCAL_USER_EMAIL, setLocalUserForTest } from "../src/local/local-user.ts";
import { ensureWorkerTokenFile } from "../src/local/worker-token-file.ts";

let app: ReturnType<typeof createApp>;
let dir: string;

beforeAll(async () => {
  env.MTL_LOCAL_MODE = true;
  await ensureLocalUser(db);
  app = createApp();
  dir = await mkdtemp(join(tmpdir(), "mtl-local-"));
});

afterAll(async () => {
  env.MTL_LOCAL_MODE = false;
  setLocalUserForTest(null);
  await rm(dir, { recursive: true, force: true });
});

describe("local mode HTTP", () => {
  it("GET /api/config is public and reports local mode", async () => {
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ local_mode: true });
  });

  it("GET /api/me without a cookie → the local user, admin", async () => {
    const res = await app.request("/api/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: LOCAL_USER_EMAIL, is_admin: true });
  });

  it("better-auth and dev login are not mounted", async () => {
    expect((await app.request("/api/auth/get-session")).status).toBe(404);
    const signIn = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: LOCAL_USER_EMAIL, password: "whatever-123" }),
    });
    expect(signIn.status).toBe(404);
    expect((await app.request("/api/dev/auto-login", { method: "POST" })).status).toBe(404);
  });

  it("admin routes are reachable", async () => {
    expect((await app.request("/api/admin/settings")).status).toBe(200);
  });

  it("/readyz ignores the runner", async () => {
    const res = await app.request("/readyz");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: true });
  });

  it("local guard is mounted: foreign Host and cross-origin writes → 403", async () => {
    expect((await app.request("/api/me", { headers: { host: "evil.example" } })).status).toBe(403);
    const res = await app.request("/api/series", {
      method: "POST",
      headers: { origin: "http://evil.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("ensureLocalUser is idempotent", async () => {
    const a = await ensureLocalUser(db);
    const b = await ensureLocalUser(db);
    expect(a.id).toBe(b.id);
  });
});

describe("local worker token file", () => {
  it("creates once (0600), keeps it, re-registers after DB loss, rotates after revoke", async () => {
    const path = join(dir, "worker-token");

    expect(await ensureWorkerTokenFile(db, path)).toBe("created");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const token = (await readFile(path, "utf8")).trim();
    expect(await authenticateWorker(token)).toMatchObject({ kind: "mac" });

    expect(await ensureWorkerTokenFile(db, path)).toBe("kept");
    expect((await readFile(path, "utf8")).trim()).toBe(token);

    // DB mất hash (DB bị xoá/khôi phục) → thêm lại cùng hash, file không đổi.
    await db.delete(workerTokens).where(eq(workerTokens.tokenHash, hashWorkerToken(token)));
    expect(await ensureWorkerTokenFile(db, path)).toBe("restored");
    expect((await readFile(path, "utf8")).trim()).toBe(token);
    const identity = await authenticateWorker(token);
    expect(identity).toMatchObject({ kind: "mac" });

    // Thu hồi trên UI → boot kế tiếp sinh token mới.
    await revokeWorkerToken(identity?.tokenId ?? "");
    expect(await ensureWorkerTokenFile(db, path)).toBe("created");
    const rotated = (await readFile(path, "utf8")).trim();
    expect(rotated).not.toBe(token);
    expect(await authenticateWorker(rotated)).toMatchObject({ kind: "mac" });
  });

  it("garbage in the file → new token", async () => {
    const path = join(dir, "garbage-token");
    await writeFile(path, "not-a-token\n", { mode: 0o644 });
    expect(await ensureWorkerTokenFile(db, path)).toBe("created");
    expect((await readFile(path, "utf8")).trim()).toMatch(/^mtlw_/);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});

/** Major của client `pg_dump` trong PATH (`pg_dump (PostgreSQL) 16.4` → 16); không có → null. */
const pgDumpMajor = (() => {
  try {
    const out = execFileSync("pg_dump", ["--version"], { encoding: "utf8" });
    const m = /(\d+)(?:\.\d+)?/.exec(out.replace(/^[^)]*\)/, ""));
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
})();

/** Major của server test (`server_version_num` 170004 → 17). */
const [serverRow] = await db.execute<{ v: string }>(sql`select current_setting('server_version_num') as v`);
const serverMajor = Math.floor(Number(serverRow?.v ?? 0) / 10_000);

// pg_dump từ chối dump server mới hơn client ("server version mismatch") — CI ubuntu có client 16, server test 17;
// máy dev không cài client. Image self-host luôn có client 17 nên chỉ bỏ ca này khi môi trường không đủ.
const dumpSkipReason =
  pgDumpMajor === null
    ? "không có pg_dump trong PATH"
    : pgDumpMajor < serverMajor
      ? `pg_dump ${pgDumpMajor} < server ${serverMajor}`
      : null;

describe("boot backup", () => {
  it.skipIf(dumpSkipReason !== null)(
    `dumps a migrated DB to a non-empty .dump file${dumpSkipReason ? ` (skip: ${dumpSkipReason})` : ""}`,
    async () => {
      const backups = join(dir, "backups");
      await mkdir(backups);
      const r = await backupBeforeMigrate({ databaseUrl: testDatabaseUrl("api"), dir: backups });
      expect(r.skipped).toBe(false);
      const files = await readdir(backups);
      expect(files).toHaveLength(1);
      expect((await stat(join(backups, files[0] ?? ""))).size).toBeGreaterThan(0);
    },
  );
});
