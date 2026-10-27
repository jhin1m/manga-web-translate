/**
 * Migration bỏ workspace (0015–0017): DB còn workspace bị chặn trước khi đổi gì; token nền tảng cũ thành `modal`.
 * Mỗi ca dựng DB riêng tới 0014 (thư mục migration tạm, journal cắt) rồi chạy tiếp toàn bộ.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../src/client.ts";
import { migrationsFolder } from "../src/migrate.ts";
import { testDatabaseUrl } from "../src/testing.ts";

const url = testDatabaseUrl("db_mig");
const dbName = decodeURIComponent(new URL(url).pathname.slice(1));
const tmp = mkdtempSync(join(tmpdir(), "mtl-mig-"));

/** Thư mục migration chỉ gồm 0000–0014 (trước khi bỏ workspace). */
const before = join(tmp, "before");
cpSync(migrationsFolder, before, { recursive: true });
const journalPath = join(before, "meta", "_journal.json");
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { idx: number }[] };
journal.entries = journal.entries.filter((e) => e.idx <= 14);
writeFileSync(journalPath, JSON.stringify(journal));

async function admin<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const u = new URL(url);
  u.pathname = "/postgres";
  const sql = postgres(u.toString(), { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

async function migrateTo(folder: string) {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await close();
  }
}

async function query<T extends Record<string, unknown>>(text: string): Promise<T[]> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return (await sql.unsafe(text)) as unknown as T[];
  } finally {
    await sql.end();
  }
}

beforeEach(async () => {
  await admin(async (sql) => {
    await sql.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await sql.unsafe(`CREATE DATABASE "${dbName}"`);
  });
  await migrateTo(before);
});

afterAll(async () => {
  await admin((sql) => sql.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`));
  rmSync(tmp, { recursive: true, force: true });
});

describe("single-user migrations", () => {
  it("refuses a DB that still has workspaces and changes nothing", async () => {
    await query(`INSERT INTO organization (name, slug, created_at) VALUES ('ws', 'ws', now())`);
    await expect(migrateTo(migrationsFolder)).rejects.toThrow();
    const cols = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'worker_tokens'`,
    );
    expect(cols.map((c) => c.column_name)).toContain("workspace_id");
    expect(cols.map((c) => c.column_name)).not.toContain("kind");
  });

  it("backfills platform tokens as modal and drops every workspace trace", async () => {
    await query(`INSERT INTO worker_tokens (id, name, token_hash) VALUES (gen_random_uuid(), 'modal', 'h1')`);
    await migrateTo(migrationsFolder);
    expect(await query(`SELECT kind FROM worker_tokens`)).toEqual([{ kind: "modal" }]);
    const leftovers = await query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND (column_name IN ('workspace_id', 'active_organization_id')
         OR table_name IN ('organization', 'member', 'invitation', 'workspace_settings', 'workspace_fonts'))`,
    );
    expect(leftovers).toEqual([]);
  });
});
