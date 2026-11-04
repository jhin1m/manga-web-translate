/**
 * Migration system_settings: pipeline của hàng user_settings mới nhất được copy 1 lần; không có → hàng mặc định.
 * Mỗi ca dựng DB riêng tới 0020 (thư mục migration tạm, journal cắt) rồi chạy tiếp toàn bộ.
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

const url = testDatabaseUrl("db_sysset");
const dbName = decodeURIComponent(new URL(url).pathname.slice(1));
const tmp = mkdtempSync(join(tmpdir(), "mtl-mig-"));

/** Thư mục migration chỉ gồm 0000–0020 (trước system_settings). */
const before = join(tmp, "before");
cpSync(migrationsFolder, before, { recursive: true });
const journalPath = join(before, "meta", "_journal.json");
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { idx: number }[] };
journal.entries = journal.entries.filter((e) => e.idx <= 20);
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

const addUser = (id: string) =>
  query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ('${id}', 'u', '${id}@example.com', false, now(), now())`,
  );

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

describe("system_settings migration", () => {
  it("copies the pipeline of the most recently updated user_settings row", async () => {
    const older = "00000000-0000-4000-8000-000000000001";
    const newer = "00000000-0000-4000-8000-000000000002";
    await addUser(older);
    await addUser(newer);
    await query(
      `INSERT INTO user_settings (user_id, pipeline, created_at, updated_at) VALUES
       ('${older}', '{"inpainter":"older"}', now(), now() - interval '2 days'),
       ('${newer}', '{"inpainter":"newer"}', now(), now() - interval '1 day')`,
    );
    await migrateTo(migrationsFolder);
    expect(await query(`SELECT id, pipeline FROM system_settings`)).toEqual([
      { id: 1, pipeline: { inpainter: "newer" } },
    ]);
  });

  it("creates a default row when no user_settings exist, and enforces a single row", async () => {
    await migrateTo(migrationsFolder);
    expect(await query(`SELECT id, pipeline, signup_enabled FROM system_settings`)).toEqual([
      { id: 1, pipeline: {}, signup_enabled: null },
    ]);
    await expect(query(`INSERT INTO system_settings (id) VALUES (2)`)).rejects.toThrow();
  });
});
