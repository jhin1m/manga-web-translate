/**
 * Tiện ích test: mỗi package VÀ mỗi checkout (repo chính / từng git worktree) có DB test riêng — tránh 2 lần chạy
 * song song reset (`DROP DATABASE … WITH (FORCE)`) DB của nhau giữa chừng.
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadRootEnv } from "./env.ts";
import { runMigrations } from "./migrate.ts";

/** 8 hex từ đường dẫn thật của gốc checkout — ổn định giữa các lần chạy, khác nhau giữa các worktree. */
const checkoutTag = (): string =>
  createHash("sha1")
    .update(realpathSync(fileURLToPath(new URL("../../..", import.meta.url))))
    .digest("hex")
    .slice(0, 8);

/** URL DB test cho một package: TEST_DATABASE_URL + "_<suffix>_<checkout>". */
export function testDatabaseUrl(suffix: string): string {
  loadRootEnv();
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL is required for tests");
  const u = new URL(base);
  u.pathname = `${u.pathname}_${suffix}_${checkoutTag()}`;
  return u.toString();
}

/** Xoá DB test (nếu có), tạo lại, chạy toàn bộ migration từ đầu — đồng thời là test migration sạch. */
export async function resetTestDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes("test")) throw new Error(`refusing to reset non-test db "${name}"`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await sql.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await sql.end();
  }
  await runMigrations(url);
}
