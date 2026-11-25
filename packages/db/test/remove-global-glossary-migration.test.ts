/**
 * Migration bỏ glossary chung: entry chung được chép vào series cùng người dùng + cùng cặp nguồn→đích mà series chưa có
 * term đó (entry series thắng); entry không có series cùng cặp (hoặc cặp NULL) chuyển vào glossary_global_archive; sau
 * đó series_id NOT NULL, unique (user_id, series_id, source_term). File down thêm lại cột / unique cũ và trả entry lưu
 * trữ về glossary chung. Mỗi ca dựng DB riêng tới 0030 (thư mục migration tạm, journal cắt) rồi chạy tiếp tới 0031.
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

const url = testDatabaseUrl("db_glossary_mig");
const dbName = decodeURIComponent(new URL(url).pathname.slice(1));
const tmp = mkdtempSync(join(tmpdir(), "mtl-mig-"));
const downFile = join(migrationsFolder, "..", "migrations-down", "0031_remove_global_glossary.down.sql");

/** Bản sao thư mục migration chỉ gồm 0000–`maxIdx` (journal cắt). */
function migrationsThrough(name: string, maxIdx: number): string {
  const dir = join(tmp, name);
  cpSync(migrationsFolder, dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { idx: number }[] };
  journal.entries = journal.entries.filter((e) => e.idx <= maxIdx);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

/** 0000–0030: còn glossary chung. */
const before = migrationsThrough("before", 30);
/** 0000–0031: file down của 0031 gỡ dòng migration mới nhất nên phải là 0031 (down chạy từ mới nhất về). */
const through = migrationsThrough("through", 31);

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

const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const KO_VI = "00000000-0000-4000-8000-0000000000a1";
const KO_VI_2 = "00000000-0000-4000-8000-0000000000a2";
const KO_EN = "00000000-0000-4000-8000-0000000000a3";
const U2_KO_VI = "00000000-0000-4000-8000-0000000000b1";

async function seed() {
  for (const id of [U1, U2]) {
    await query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
       VALUES ('${id}', 'u', '${id}@example.com', false, now(), now())`,
    );
  }
  await query(
    `INSERT INTO series (id, user_id, title, source_lang, target_lang, glossary_rev) VALUES
     ('${KO_VI}', '${U1}', 'A', 'ko', 'vi', 3),
     ('${KO_VI_2}', '${U1}', 'B', 'ko', 'vi', 0),
     ('${KO_EN}', '${U1}', 'C', 'ko', 'en', 0),
     ('${U2_KO_VI}', '${U2}', 'D', 'ko', 'vi', 0)`,
  );
  const entry = (
    user: string,
    seriesId: string | null,
    src: string | null,
    tgt: string | null,
    term: string,
    to: string,
  ) =>
    `(gen_random_uuid(), '${user}', ${seriesId ? `'${seriesId}'` : "NULL"}, ${src ? `'${src}'` : "NULL"},
      ${tgt ? `'${tgt}'` : "NULL"}, '${term}', '${to}', 'n-${to}', ${term === "용"})`;
  await query(
    `INSERT INTO glossary_entries (id, user_id, series_id, source_lang, target_lang, source_term, target_term, note,
       case_sensitive) VALUES
     ${[
       // Chung ko→vi của U1: 검 trùng entry riêng của series A (A giữ bản riêng), 용 thì A chưa có.
       entry(U1, null, "ko", "vi", "검", "gươm"),
       entry(U1, null, "ko", "vi", "용", "rồng"),
       // Chung ko→en của U1: chỉ series C.
       entry(U1, null, "ko", "en", "검", "sword"),
       // Chung ja→vi của U1: U1 không có series ja→vi → lưu trữ.
       entry(U1, null, "ja", "vi", "剣", "kiếm nhật"),
       // Chung cặp NULL (API cũ trong cửa sổ rollback): chưa từng áp cho series nào → lưu trữ.
       entry(U1, null, null, null, "옛", "cũ"),
       // Chung ko→en của U2: U2 chỉ có series ko→vi, series ko→en của U1 không tính → lưu trữ.
       entry(U2, null, "ko", "en", "마법", "magic"),
       entry(U1, KO_VI, null, null, "검", "kiếm"),
       // U2 không có entry chung → series của U2 không nhận gì từ U1.
       entry(U2, U2_KO_VI, null, null, "마법", "phép"),
     ].join(",\n")}`,
  );
}

/** Entry chung trước migration (id + cặp) — để so với bảng lưu trữ / kết quả down. */
const sharedRows = () =>
  query<{ id: string; user_id: string; source_lang: string | null; target_lang: string | null; source_term: string }>(
    `SELECT id, user_id, source_lang, target_lang, source_term FROM glossary_entries WHERE series_id IS NULL
     ORDER BY source_term COLLATE "C"`,
  );

const archived = () =>
  query<{
    id: string;
    user_id: string;
    source_lang: string | null;
    target_lang: string | null;
    source_term: string;
    target_term: string;
    note: string;
    case_sensitive: boolean;
    origin: string;
  }>(
    `SELECT id, user_id, source_lang, target_lang, source_term, target_term, note, case_sensitive, origin
     FROM glossary_global_archive ORDER BY source_term COLLATE "C"`,
  );

const rows = () =>
  query<{ series_id: string; source_term: string; target_term: string; note: string; case_sensitive: boolean }>(
    `SELECT series_id, source_term, target_term, note, case_sensitive FROM glossary_entries
     ORDER BY series_id, source_term`,
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

describe("remove global glossary migration", () => {
  it("copies shared entries into same-pair series without overriding series entries, then drops them", async () => {
    await seed();
    const ids = new Map((await sharedRows()).map((r) => [`${r.user_id}|${r.source_term}|${r.source_lang}`, r.id]));
    await migrateTo(through);

    expect(await rows()).toEqual([
      { series_id: KO_VI, source_term: "검", target_term: "kiếm", note: "n-kiếm", case_sensitive: false },
      { series_id: KO_VI, source_term: "용", target_term: "rồng", note: "n-rồng", case_sensitive: true },
      { series_id: KO_VI_2, source_term: "검", target_term: "gươm", note: "n-gươm", case_sensitive: false },
      { series_id: KO_VI_2, source_term: "용", target_term: "rồng", note: "n-rồng", case_sensitive: true },
      { series_id: KO_EN, source_term: "검", target_term: "sword", note: "n-sword", case_sensitive: false },
      { series_id: U2_KO_VI, source_term: "마법", target_term: "phép", note: "n-phép", case_sensitive: false },
    ]);
    // Bản chép thuộc đúng chủ series, origin giữ 'user'; glossary hiệu lực không đổi → rev giữ nguyên.
    expect(
      await query(`SELECT count(*)::int AS n FROM glossary_entries g JOIN series s ON s.id = g.series_id
                   WHERE g.user_id <> s.user_id OR g.origin <> 'user'`),
    ).toEqual([{ n: 0 }]);
    expect(await query(`SELECT glossary_rev FROM series WHERE id = '${KO_VI}'`)).toEqual([{ glossary_rev: 3 }]);
    // Entry chung không có series cùng cặp (ja→vi; ko→en của U2) hoặc cặp NULL → lưu trữ nguyên vẹn, giữ id gốc. Entry
    // đã chép vào series (ko→vi, ko→en của U1) không vào lưu trữ.
    expect(await archived()).toEqual([
      {
        id: ids.get(`${U1}|剣|ja`),
        user_id: U1,
        source_lang: "ja",
        target_lang: "vi",
        source_term: "剣",
        target_term: "kiếm nhật",
        note: "n-kiếm nhật",
        case_sensitive: false,
        origin: "user",
      },
      {
        id: ids.get(`${U2}|마법|ko`),
        user_id: U2,
        source_lang: "ko",
        target_lang: "en",
        source_term: "마법",
        target_term: "magic",
        note: "n-magic",
        case_sensitive: false,
        origin: "user",
      },
      {
        id: ids.get(`${U1}|옛|null`),
        user_id: U1,
        source_lang: null,
        target_lang: null,
        source_term: "옛",
        target_term: "cũ",
        note: "n-cũ",
        case_sensitive: false,
        origin: "user",
      },
    ]);
    // Index (user_id, series_id) thừa so với unique cùng tiền tố → đã gỡ.
    expect(
      await query(`SELECT indexname FROM pg_indexes WHERE tablename = 'glossary_entries' ORDER BY indexname`),
    ).toEqual([{ indexname: "glossary_entries_pkey" }, { indexname: "glossary_entries_scope_term_uq" }]);
    expect(
      await query(`SELECT column_name FROM information_schema.columns
                   WHERE table_name = 'glossary_entries' AND column_name IN ('source_lang', 'target_lang')`),
    ).toEqual([]);

    // series_id NOT NULL; unique theo (user, series, term).
    await expect(
      query(`INSERT INTO glossary_entries (id, user_id, series_id, source_term, target_term)
             VALUES (gen_random_uuid(), '${U1}', NULL, 'x', 'y')`),
    ).rejects.toThrow(/null value/);
    await expect(
      query(`INSERT INTO glossary_entries (id, user_id, series_id, source_term, target_term)
             VALUES (gen_random_uuid(), '${U1}', '${KO_VI}', '용', 'long')`),
    ).rejects.toThrow(/glossary_entries_scope_term_uq/);
  });

  it("down file restores the old columns, scope unique and archived shared entries", async () => {
    await seed();
    const shared = await sharedRows();
    await migrateTo(through);
    const count = async () =>
      (await query<{ n: number }>(`SELECT count(*)::int AS n FROM glossary_entries`))[0]?.n ?? 0;
    const n = await count();
    const archivedIds = new Set((await archived()).map((r) => r.id));
    const archivedN = archivedIds.size;
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe(readFileSync(downFile, "utf8"));
    } finally {
      await sql.end();
    }
    // Entry lưu trữ trở lại glossary chung đúng cặp, đúng id; bảng lưu trữ bị xoá.
    expect(await count()).toBe(n + archivedN);
    expect(await sharedRows()).toEqual(shared.filter((r) => archivedIds.has(r.id)));
    expect(await query(`SELECT to_regclass('glossary_global_archive') AS t`)).toEqual([{ t: null }]);
    expect(
      await query(`SELECT column_name, is_nullable FROM information_schema.columns
                   WHERE table_name = 'glossary_entries' AND column_name IN ('series_id', 'source_lang', 'target_lang')
                   ORDER BY column_name`),
    ).toEqual([
      { column_name: "series_id", is_nullable: "YES" },
      { column_name: "source_lang", is_nullable: "YES" },
      { column_name: "target_lang", is_nullable: "YES" },
    ]);
    // Bản cũ ghi lại được entry chung theo cặp; unique cũ (NULLS NOT DISTINCT) chặn trùng trong cùng cặp.
    const insertShared = `INSERT INTO glossary_entries (id, user_id, series_id, source_lang, target_lang, source_term,
                            target_term) VALUES (gen_random_uuid(), '${U1}', NULL, 'ko', 'vi', '검', 'gươm')`;
    await query(insertShared);
    await expect(query(insertShared)).rejects.toThrow(/glossary_entries_scope_term_uq/);
    // Chạy lại up sau down: migration được gỡ khỏi bảng drizzle nên áp lại; entry chung mới được chép rồi xoá, entry
    // không có series cùng cặp lại vào lưu trữ.
    await migrateTo(through);
    expect(await query(`SELECT count(*)::int AS n FROM glossary_entries WHERE series_id IS NULL`)).toEqual([{ n: 0 }]);
    expect(await count()).toBe(n);
    expect((await archived()).length).toBe(archivedN);
  });
});
