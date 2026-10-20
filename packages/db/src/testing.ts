/** Tiện ích test: mỗi package có DB test riêng (tránh 2 package reset cùng DB khi chạy song song). */
import postgres from "postgres";
import { loadRootEnv } from "./env.ts";
import { runMigrations } from "./migrate.ts";

/** URL DB test cho một package: TEST_DATABASE_URL + "_<suffix>". */
export function testDatabaseUrl(suffix: string): string {
  loadRootEnv();
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL is required for tests");
  const u = new URL(base);
  u.pathname = `${u.pathname}_${suffix}`;
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
