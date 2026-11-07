/**
 * Backup DB trước migrate (chế độ local, mỗi lần app khởi động): DB đã có bảng migration của drizzle → `pg_dump -Fc`
 * vào `dir/mtl-<UTC>-m<N>.dump` (N = số migration đã áp lúc dump; ghi tmp rồi rename). DB trống (lần đầu) → bỏ qua.
 * Lỗi / quá giờ → ném: app không migrate khi chưa có bản backup (fail-closed; thoát hiểm MTL_SKIP_BOOT_BACKUP=1).
 *
 * Giữ: `keep` bản mới nhất + bản mới nhất của mỗi `SCHEMA_GENERATIONS` phiên bản schema gần nhất → restart nhiều lần
 * (hoặc crash loop) sau khi nâng cấp không xoá mất bản dump của schema TRƯỚC nâng cấp.
 */
import { execFile } from "node:child_process";
import { readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createDb } from "@mtl/db";
import { sql } from "drizzle-orm";

const exec = promisify(execFile);

export const BACKUP_RE = /^mtl-(\d{8}T\d{6}Z)-m(\d+)\.dump$/;
/** Số phiên bản schema (gần nhất) luôn giữ ít nhất 1 bản dump. */
export const SCHEMA_GENERATIONS = 3;
/** pg_dump treo (chờ lock) → boot kẹt mãi, healthcheck không bao giờ xanh → giới hạn cứng. */
const PG_DUMP_TIMEOUT_MS = 10 * 60_000;

/** `2026-11-07T13:20:05.123Z` → `20261107T132005Z`. */
export const backupStamp = (d: Date): string =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

export const backupName = (d: Date, migrations: number) => `mtl-${backupStamp(d)}-m${migrations}.dump`;

/**
 * Xoá bản backup cũ: giữ `keep` bản mới nhất và bản mới nhất của mỗi phiên bản schema trong `SCHEMA_GENERATIONS`
 * phiên bản cao nhất. File không đúng mẫu tên không đụng.
 */
export async function pruneBackups(dir: string, keep: number): Promise<string[]> {
  const items = (await readdir(dir))
    .map((name) => ({ name, m: BACKUP_RE.exec(name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null)
    .map(({ name, m }) => ({ name, stamp: m[1] ?? "", schema: Number(m[2]) }))
    .sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0)); // mới nhất trước
  const keepNames = new Set(items.slice(0, keep).map((x) => x.name));
  const schemas = [...new Set(items.map((x) => x.schema))].sort((a, b) => b - a).slice(0, SCHEMA_GENERATIONS);
  for (const s of schemas) {
    const newest = items.find((x) => x.schema === s);
    if (newest) keepNames.add(newest.name);
  }
  const drop = items.filter((x) => !keepNames.has(x.name)).map((x) => x.name);
  for (const n of drop) await rm(join(dir, n), { force: true });
  return drop.sort();
}

/** Số migration đã áp; DB chưa có bảng migration (DB mới) → null. */
async function appliedMigrations(databaseUrl: string): Promise<number | null> {
  const { db, close } = createDb(databaseUrl, { max: 1 });
  try {
    const [reg] = await db.execute<{ t: string | null }>(
      sql`select to_regclass('drizzle.__drizzle_migrations')::text as t`,
    );
    if (!reg?.t) return null;
    const [row] = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    return row?.n ?? 0;
  } finally {
    await close();
  }
}

/** Mật khẩu tách khỏi URL → truyền qua PGPASSWORD (không lộ trong argv / `ps`). */
function splitPassword(databaseUrl: string): { url: string; password: string | undefined } {
  const u = new URL(databaseUrl);
  const password = u.password ? decodeURIComponent(u.password) : undefined;
  u.password = "";
  return { url: u.toString(), password };
}

export type BackupResult = { skipped: true } | { skipped: false; file: string; pruned: string[] };

export async function backupBeforeMigrate({
  databaseUrl,
  dir,
  keep = 5,
  now = new Date(),
}: {
  databaseUrl: string;
  dir: string;
  keep?: number;
  now?: Date;
}): Promise<BackupResult> {
  const migrations = await appliedMigrations(databaseUrl);
  if (migrations === null) return { skipped: true };
  const name = backupName(now, migrations);
  const file = join(dir, name);
  const tmp = join(dir, `.${name}.tmp`);
  const { url, password } = splitPassword(databaseUrl);
  try {
    // Không qua shell; URL là đối số riêng (không nội suy). Chờ lock tối đa 60s rồi lỗi thay vì treo.
    await exec(
      "pg_dump",
      ["--format=custom", "--no-owner", "--no-privileges", "--lock-wait-timeout=60s", "--file", tmp, url],
      { timeout: PG_DUMP_TIMEOUT_MS, env: { ...process.env, ...(password ? { PGPASSWORD: password } : {}) } },
    );
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    const e = err as { stderr?: string; killed?: boolean };
    const detail = e.killed ? `quá ${PG_DUMP_TIMEOUT_MS / 60_000} phút` : e.stderr?.trim();
    throw new Error(`pg_dump lỗi${detail ? `: ${detail}` : ""}`, { cause: err });
  }
  return { skipped: false, file, pruned: await pruneBackups(dir, keep) };
}
