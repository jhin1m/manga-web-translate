/**
 * Chặn hạ cấp (chế độ local, trước backup + migrate — không dump lại mỗi lần image cũ restart): DB đã áp migration mới hơn mọi migration image này biết
 * (người dùng ghim MTL_TAG cũ mà chưa khôi phục dump, hoặc `latest` bị kéo lùi) → drizzle không áp gì, không báo lỗi,
 * code cũ chạy trên schema mới. Phát hiện đúng theo tiêu chí của drizzle: `max(created_at)` trong
 * `drizzle.__drizzle_migrations` so với `when` lớn nhất trong `migrations/meta/_journal.json` của image.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDb, migrationsFolder } from "@mtl/db";
import { sql } from "drizzle-orm";

export type JournalState = { count: number; lastWhen: number };
export type DbMigrationState = { count: number; lastCreatedAt: number };

export class SchemaNewerThanImageError extends Error {}

/** Trạng thái migration image mang theo (đọc journal drizzle-kit). */
export async function readJournal(folder = migrationsFolder): Promise<JournalState> {
  const raw = JSON.parse(await readFile(join(folder, "meta", "_journal.json"), "utf8")) as {
    entries?: { when?: unknown }[];
  };
  const whens = (raw.entries ?? []).map((e) => Number(e.when)).filter(Number.isFinite);
  return { count: whens.length, lastWhen: whens.length ? Math.max(...whens) : 0 };
}

/** Trạng thái migration đã áp trong DB; chưa có bảng migration (DB mới) hoặc bảng rỗng → null. */
async function readDbMigrations(databaseUrl: string): Promise<DbMigrationState | null> {
  const { db, close } = createDb(databaseUrl, { max: 1 });
  try {
    const [reg] = await db.execute<{ t: string | null }>(
      sql`select to_regclass('drizzle.__drizzle_migrations')::text as t`,
    );
    if (!reg?.t) return null;
    const [row] = await db.execute<{ n: number; last: string | null }>(
      sql`select count(*)::int as n, max(created_at)::text as last from drizzle.__drizzle_migrations`,
    );
    if (!row?.last) return null;
    return { count: row.n, lastCreatedAt: Number(row.last) };
  } finally {
    await close();
  }
}

/** Thuần (unit test): DB mới hơn image → lỗi kèm hướng dẫn; ngược lại null. */
export function schemaDowngradeError(dbState: DbMigrationState | null, image: JournalState): Error | null {
  if (!dbState || dbState.lastCreatedAt <= image.lastWhen) return null;
  return new SchemaNewerThanImageError(
    `DB đã ở schema m${dbState.count}, mới hơn bản app đang chạy (chỉ biết tới m${image.count}) — ` +
      "đây là bản cũ hơn bản đã migrate DB; chạy tiếp sẽ ghi sai dữ liệu nên dừng khởi động. Cách xử lý: " +
      "(1) dùng lại bản mới: bỏ MTL_TAG (hoặc đặt MTL_TAG=<bản mới>) rồi `docker compose pull && docker compose up -d`; " +
      `hoặc (2) thật sự muốn quay về bản cũ: khôi phục bản dump tạo khi còn chạy bản cũ (data/backups/mtl-*-m<N>.dump, N ≤ ${image.count}) ` +
      "(hướng dẫn pg_restore: docs/self-host.md, mục 'Backup DB tự động + khôi phục') rồi mới `up -d`.",
  );
}

/** Ném nếu DB thuộc bản app mới hơn image hiện tại. */
export async function assertSchemaNotNewer(databaseUrl: string): Promise<void> {
  const err = schemaDowngradeError(await readDbMigrations(databaseUrl), await readJournal());
  if (err) throw err;
}
