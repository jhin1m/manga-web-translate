/**
 * Glossary của series (mỗi entry thuộc một series, áp theo cặp ngôn ngữ hiện tại của series). Tạo / liệt kê / CSV theo
 * series trên path; sửa / xoá theo id entry. Mọi thay đổi tăng `glossary_rev` của series đó trong CÙNG transaction
 * (job cũ không bị dùng lại nhầm). Tăng rev ĐẦU transaction (khoá dòng series trước khi ghi entry): AI ghi entry
 * dưới khoá series (lib/series-memory.ts), ghi entry trước rồi mới khoá series thì hai bên có thể chờ nhau. Entry người
 * dùng tạo / sửa có `origin='user'`; entry AI ghi có `'ai'`.
 */
import { glossaryEntries, type Scoped, series } from "@mtl/db";
import { type ApiErrorBody, apiErrorBody, apiErrorMessageVi } from "@mtl/shared";
import { and, eq, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { apiError, codeError } from "../lib/api-error.ts";
import { parseJson } from "../lib/validate.ts";
import type { AppEnv } from "../middleware/user.ts";

export const MAX_IMPORT_ROWS = 5000;
const MAX_CSV_CHARS = 2 * 1024 * 1024;

const Entry = z.object({
  source_term: z.string().trim().min(1).max(200),
  target_term: z.string().trim().min(1).max(200),
  note: z.string().trim().max(500).default(""),
  case_sensitive: z.boolean().default(false),
});
const EntryPatch = Entry.partial().refine((v) => Object.keys(v).length > 0, "no field to update");
const ImportBody = z.object({
  csv: z.string().max(MAX_CSV_CHARS),
  mode: z.enum(["merge", "replace"]).default("merge"),
});

type EntryRow = typeof glossaryEntries.$inferSelect;
type EntryIn = z.infer<typeof Entry>;
const entryView = (e: EntryRow) => ({
  id: e.id,
  series_id: e.seriesId,
  source_term: e.sourceTerm,
  target_term: e.targetTerm,
  note: e.note,
  case_sensitive: e.caseSensitive,
  /** "user" hoặc "ai" (AI ghi từ kết quả dịch; sửa thì thành "user"). */
  origin: e.origin,
  updated_at: e.updatedAt,
});

const byTerm = (a: EntryRow, b: EntryRow) => a.sourceTerm.localeCompare(b.sourceTerm);
const seriesWhere = (seriesId: string) => eq(glossaryEntries.seriesId, seriesId);

/** glossary_rev + 1 cho series có entry vừa đổi. */
async function bumpGlossaryRev(tx: Scoped, seriesId: string): Promise<void> {
  await tx.update(series, eq(series.id, seriesId), {
    // Tăng atomic trong DB (Scoped.update chỉ khai báo kiểu giá trị thường).
    glossaryRev: sql`${series.glossaryRev} + 1` as unknown as number,
  });
}

/** Vi phạm ràng buộc unique term (2 request đua nhau cùng qua assertUniqueTerm) → 409 như kiểm tra trước. */
function isTermConflict(err: unknown): boolean {
  for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: string; constraint_name?: string };
    if (pg.code === "23505" && pg.constraint_name === "glossary_entries_scope_term_uq") return true;
  }
  return false;
}

async function writeOrConflict<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn();
  } catch (err) {
    if (isTermConflict(err)) throw apiError(409, "duplicate_term.unnamed");
    throw err;
  }
}

async function assertUniqueTerm(tx: Scoped, seriesId: string, term: string, exceptId?: string) {
  const dup = await tx.find(glossaryEntries, and(seriesWhere(seriesId), eq(glossaryEntries.sourceTerm, term)) as SQL);
  if (dup && dup.id !== exceptId) throw apiError(409, "duplicate_term", { term });
}

// ---- CSV (RFC 4180: dấu phẩy, nháy kép bao trường, "" = nháy kép trong trường) ----

export const CSV_HEADER = ["source_term", "target_term", "note", "case_sensitive"] as const;
const FORMULA_START = /^[=+\-@\t\r]/;
/** Bỏ ' do toCsv thêm trước ô dạng công thức. */
const unescapeCell = (v: string | undefined) => (v?.startsWith("'") && FORMULA_START.test(v.slice(1)) ? v.slice(1) : v);

export function toCsv(rows: EntryIn[]): string {
  const cell = (raw: string) => {
    // Chặn CSV injection: ô bắt đầu bằng = + - @ bị Excel chạy như công thức → thêm ' (import bỏ lại).
    const v = FORMULA_START.test(raw) ? `'${raw}` : raw;
    return /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
  };
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push([r.source_term, r.target_term, r.note, r.case_sensitive ? "true" : "false"].map(cell).join(","));
  }
  // BOM để Excel mở đúng UTF-8 (tiếng Hàn/Việt).
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.startsWith("﻿") ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (quoted) throw new Error(apiErrorMessageVi("csv_unclosed_quote"));
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** Lỗi 1 dòng CSV: số dòng + mã / tham số / câu tiếng Việt như lỗi API. */
export type CsvLineError = { line: number } & ApiErrorBody;

/** CSV → entry hợp lệ; lỗi theo số dòng (1 = header, 0 = cả file). Trùng source_term trong file → dòng sau thắng. */
export function parseGlossaryCsv(text: string): { entries: EntryIn[]; errors: CsvLineError[] } {
  let rows: string[][];
  try {
    rows = parseCsvRows(text);
  } catch {
    // parseCsvRows chỉ ném khi thiếu nháy kép đóng.
    return { entries: [], errors: [{ line: 0, ...apiErrorBody("csv_unclosed_quote") }] };
  }
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (col("source_term") < 0 || col("target_term") < 0) {
    return { entries: [], errors: [{ line: 1, ...apiErrorBody("csv_missing_columns") }] };
  }
  const errors: CsvLineError[] = [];
  const byTermMap = new Map<string, EntryIn>();
  rows.slice(1).forEach((r, i) => {
    const get = (name: string) => (col(name) >= 0 ? unescapeCell(r[col(name)] ?? "") : undefined);
    const cs = get("case_sensitive")?.trim().toLowerCase();
    const parsed = Entry.safeParse({
      source_term: get("source_term"),
      target_term: get("target_term"),
      note: get("note") ?? "",
      case_sensitive: cs === "true" || cs === "1" || cs === "yes",
    });
    if (parsed.success) byTermMap.set(parsed.data.source_term, parsed.data);
    else {
      const fields = parsed.error.issues.map((x) => x.path.join(".") || x.message).join(", ");
      errors.push({ line: i + 2, ...apiErrorBody("csv_invalid_fields", { fields }) });
    }
  });
  return { entries: [...byTermMap.values()], errors };
}

const toEntryIn = (e: EntryRow): EntryIn => ({
  source_term: e.sourceTerm,
  target_term: e.targetTerm,
  note: e.note,
  case_sensitive: e.caseSensitive,
});

// ---- Route ----

export const glossaryRoutes = new Hono<AppEnv>();

/** Series từ path (đã kiểm thuộc người dùng). */
const seriesOf = (sdb: Scoped, seriesParam: string) => sdb.byId(series, seriesParam, "series");

async function list(sdb: Scoped, seriesId: string) {
  const rows = await sdb.select(glossaryEntries, seriesWhere(seriesId));
  return { entries: rows.sort(byTerm).map(entryView) };
}

async function create(sdb: Scoped, seriesId: string, body: EntryIn) {
  return writeOrConflict(() =>
    sdb.transaction(async (tx) => {
      await bumpGlossaryRev(tx, seriesId);
      await assertUniqueTerm(tx, seriesId, body.source_term);
      return tx.insert(glossaryEntries, {
        seriesId,
        sourceTerm: body.source_term,
        targetTerm: body.target_term,
        note: body.note,
        caseSensitive: body.case_sensitive,
        origin: "user",
      });
    }),
  );
}

async function exportCsv(sdb: Scoped, seriesId: string, filename: string) {
  const rows = (await sdb.select(glossaryEntries, seriesWhere(seriesId))).sort(byTerm);
  return new Response(toCsv(rows.map(toEntryIn)), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

async function importCsv(sdb: Scoped, seriesId: string, body: z.infer<typeof ImportBody>) {
  const { entries, errors } = parseGlossaryCsv(body.csv);
  if (errors.length) {
    throw codeError(400, "invalid_csv", { errors });
  }
  if (entries.length === 0) throw apiError(400, "csv_empty");
  if (entries.length > MAX_IMPORT_ROWS) throw apiError(400, "csv_too_many_rows", { max: MAX_IMPORT_ROWS });
  return writeOrConflict(() =>
    sdb.transaction(async (tx) => {
      await bumpGlossaryRev(tx, seriesId);
      if (body.mode === "replace") await tx.delete(glossaryEntries, seriesWhere(seriesId));
      const existing = new Map((await tx.select(glossaryEntries, seriesWhere(seriesId))).map((e) => [e.sourceTerm, e]));
      let created = 0;
      let updated = 0;
      for (const e of entries) {
        const set = {
          targetTerm: e.target_term,
          note: e.note,
          caseSensitive: e.case_sensitive,
          origin: "user" as const,
        };
        const cur = existing.get(e.source_term);
        if (cur) {
          await tx.update(glossaryEntries, eq(glossaryEntries.id, cur.id), set);
          updated++;
        } else {
          await tx.insert(glossaryEntries, { seriesId, sourceTerm: e.source_term, ...set });
          created++;
        }
      }
      return { created, updated, mode: body.mode };
    }),
  );
}

glossaryRoutes.get("/series/:seriesId/glossary", async (c) => {
  const sdb = c.get("sdb");
  const s = await seriesOf(sdb, c.req.param("seriesId"));
  return c.json(await list(sdb, s.id));
});

glossaryRoutes.post("/series/:seriesId/glossary", async (c) => {
  const body = await parseJson(c, Entry);
  const sdb = c.get("sdb");
  const s = await seriesOf(sdb, c.req.param("seriesId"));
  return c.json(entryView(await create(sdb, s.id, body)), 201);
});

glossaryRoutes.get("/series/:seriesId/glossary/csv", async (c) => {
  const sdb = c.get("sdb");
  const s = await seriesOf(sdb, c.req.param("seriesId"));
  return exportCsv(sdb, s.id, `glossary-series-${s.id}.csv`);
});

glossaryRoutes.post("/series/:seriesId/glossary/csv", async (c) => {
  const body = await parseJson(c, ImportBody);
  const sdb = c.get("sdb");
  const s = await seriesOf(sdb, c.req.param("seriesId"));
  return c.json(await importCsv(sdb, s.id, body));
});

/** Sửa/xoá theo id entry — series lấy từ entry, không đổi được; rev của series đó tăng. */
glossaryRoutes.patch("/glossary/:entryId", async (c) => {
  const body = await parseJson(c, EntryPatch);
  const row = await writeOrConflict(() =>
    c.get("sdb").transaction(async (tx) => {
      const cur = await tx.byId(glossaryEntries, c.req.param("entryId"), "glossary entry");
      await bumpGlossaryRev(tx, cur.seriesId);
      if (body.source_term !== undefined) await assertUniqueTerm(tx, cur.seriesId, body.source_term, cur.id);
      const [row] = await tx.update(glossaryEntries, eq(glossaryEntries.id, cur.id), {
        sourceTerm: body.source_term,
        targetTerm: body.target_term,
        note: body.note,
        caseSensitive: body.case_sensitive,
        origin: "user",
      });
      return row ?? cur;
    }),
  );
  return c.json(entryView(row));
});

glossaryRoutes.delete("/glossary/:entryId", async (c) => {
  await c.get("sdb").transaction(async (tx) => {
    const cur = await tx.byId(glossaryEntries, c.req.param("entryId"), "glossary entry");
    await bumpGlossaryRev(tx, cur.seriesId);
    await tx.delete(glossaryEntries, eq(glossaryEntries.id, cur.id));
  });
  return c.body(null, 204);
});
