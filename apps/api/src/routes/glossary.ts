/**
 * Glossary cấp workspace (`series_id` null) và cấp series (ghi đè khi trùng source_term, xem
 * jobs/enqueue.ts translateSettings). Mọi thay đổi tăng `glossary_rev` trong CÙNG transaction (red team #3):
 * entry series → series đó; entry workspace → mọi series của workspace.
 */
import { glossaryEntries, type Scoped, series } from "@mtl/db";
import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { parseJson } from "../lib/validate.ts";
import { type AppEnv, requireWorkspace } from "../middleware/workspace.ts";

export const MAX_IMPORT_ROWS = 5000;
const MAX_CSV_CHARS = 2 * 1024 * 1024;

const Entry = z.object({
  source_term: z.string().trim().min(1).max(200),
  target_term: z.string().trim().min(1).max(200),
  note: z.string().trim().max(500).default(""),
  case_sensitive: z.boolean().default(false),
});
const EntryPatch = Entry.partial().refine((v) => Object.keys(v).length > 0, "không có trường nào để sửa");
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
  updated_at: e.updatedAt,
});

const byTerm = (a: EntryRow, b: EntryRow) => a.sourceTerm.localeCompare(b.sourceTerm);
const scopeWhere = (seriesId: string | null) =>
  seriesId ? eq(glossaryEntries.seriesId, seriesId) : isNull(glossaryEntries.seriesId);

const conflict = (error: string, message: string) =>
  new HTTPException(409, { res: Response.json({ error, message }, { status: 409 }) });

/** glossary_rev + 1 cho series bị ảnh hưởng (null = mọi series của workspace). */
async function bumpGlossaryRev(tx: Scoped, seriesId: string | null): Promise<void> {
  await tx.update(series, seriesId ? eq(series.id, seriesId) : sql`true`, {
    // Tăng atomic trong DB (Scoped.update chỉ khai báo kiểu giá trị thường).
    glossaryRev: sql`${series.glossaryRev} + 1` as unknown as number,
  });
}

async function assertUniqueTerm(tx: Scoped, seriesId: string | null, term: string, exceptId?: string) {
  const dup = await tx.find(glossaryEntries, and(scopeWhere(seriesId), eq(glossaryEntries.sourceTerm, term)) as SQL);
  if (dup && dup.id !== exceptId) throw conflict("duplicate_term", `"${term}" đã có trong glossary này`);
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
  if (quoted) throw new Error("CSV: thiếu dấu nháy kép đóng");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** CSV → entry hợp lệ; lỗi theo số dòng (1 = header). Trùng source_term trong file → dòng sau thắng. */
export function parseGlossaryCsv(text: string): { entries: EntryIn[]; errors: { line: number; message: string }[] } {
  let rows: string[][];
  try {
    rows = parseCsvRows(text);
  } catch (e) {
    return { entries: [], errors: [{ line: 0, message: (e as Error).message }] };
  }
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (col("source_term") < 0 || col("target_term") < 0) {
    return { entries: [], errors: [{ line: 1, message: "header phải có cột source_term, target_term" }] };
  }
  const errors: { line: number; message: string }[] = [];
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
    else
      errors.push({ line: i + 2, message: parsed.error.issues.map((x) => x.path.join(".") || x.message).join(", ") });
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

/** seriesId từ path (đã kiểm thuộc workspace) hoặc null cho glossary workspace. */
async function scopeOf(sdb: Scoped, seriesParam: string | undefined): Promise<string | null> {
  if (seriesParam === undefined) return null;
  return (await sdb.byId(series, seriesParam, "series")).id;
}

async function list(sdb: Scoped, seriesId: string | null) {
  const own = await sdb.select(glossaryEntries, scopeWhere(seriesId));
  const inherited = seriesId ? await sdb.select(glossaryEntries, scopeWhere(null)) : [];
  return { entries: own.sort(byTerm).map(entryView), inherited: inherited.sort(byTerm).map(entryView) };
}

async function create(sdb: Scoped, seriesId: string | null, body: EntryIn) {
  return sdb.transaction(async (tx) => {
    await assertUniqueTerm(tx, seriesId, body.source_term);
    const row = await tx.insert(glossaryEntries, {
      seriesId,
      sourceTerm: body.source_term,
      targetTerm: body.target_term,
      note: body.note,
      caseSensitive: body.case_sensitive,
    });
    await bumpGlossaryRev(tx, seriesId);
    return row;
  });
}

async function exportCsv(sdb: Scoped, seriesId: string | null, filename: string) {
  const rows = (await sdb.select(glossaryEntries, scopeWhere(seriesId))).sort(byTerm);
  return new Response(toCsv(rows.map(toEntryIn)), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

async function importCsv(sdb: Scoped, seriesId: string | null, body: z.infer<typeof ImportBody>) {
  const { entries, errors } = parseGlossaryCsv(body.csv);
  if (errors.length) {
    throw new HTTPException(400, { res: Response.json({ error: "invalid_csv", errors }, { status: 400 }) });
  }
  if (entries.length === 0) throw new HTTPException(400, { message: "CSV không có dòng nào" });
  if (entries.length > MAX_IMPORT_ROWS) throw new HTTPException(400, { message: `tối đa ${MAX_IMPORT_ROWS} dòng` });
  return sdb.transaction(async (tx) => {
    if (body.mode === "replace") await tx.delete(glossaryEntries, scopeWhere(seriesId));
    const existing = new Map((await tx.select(glossaryEntries, scopeWhere(seriesId))).map((e) => [e.sourceTerm, e]));
    let created = 0;
    let updated = 0;
    for (const e of entries) {
      const set = { targetTerm: e.target_term, note: e.note, caseSensitive: e.case_sensitive };
      const cur = existing.get(e.source_term);
      if (cur) {
        await tx.update(glossaryEntries, eq(glossaryEntries.id, cur.id), set);
        updated++;
      } else {
        await tx.insert(glossaryEntries, { seriesId, sourceTerm: e.source_term, ...set });
        created++;
      }
    }
    await bumpGlossaryRev(tx, seriesId);
    return { created, updated, mode: body.mode };
  });
}

glossaryRoutes.get("/w/:ws/glossary", requireWorkspace(), async (c) => c.json(await list(c.get("sdb"), null)));

glossaryRoutes.post("/w/:ws/glossary", requireWorkspace(), async (c) => {
  const body = await parseJson(c, Entry);
  return c.json(entryView(await create(c.get("sdb"), null, body)), 201);
});

glossaryRoutes.get("/w/:ws/glossary/csv", requireWorkspace(), (c) =>
  exportCsv(c.get("sdb"), null, "glossary-workspace.csv"),
);

glossaryRoutes.post("/w/:ws/glossary/csv", requireWorkspace(), async (c) => {
  const body = await parseJson(c, ImportBody);
  return c.json(await importCsv(c.get("sdb"), null, body));
});

glossaryRoutes.get("/w/:ws/series/:seriesId/glossary", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  return c.json(await list(sdb, await scopeOf(sdb, c.req.param("seriesId"))));
});

glossaryRoutes.post("/w/:ws/series/:seriesId/glossary", requireWorkspace(), async (c) => {
  const body = await parseJson(c, Entry);
  const sdb = c.get("sdb");
  return c.json(entryView(await create(sdb, await scopeOf(sdb, c.req.param("seriesId")), body)), 201);
});

glossaryRoutes.get("/w/:ws/series/:seriesId/glossary/csv", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const seriesId = await scopeOf(sdb, c.req.param("seriesId"));
  return exportCsv(sdb, seriesId, `glossary-series-${seriesId}.csv`);
});

glossaryRoutes.post("/w/:ws/series/:seriesId/glossary/csv", requireWorkspace(), async (c) => {
  const body = await parseJson(c, ImportBody);
  const sdb = c.get("sdb");
  return c.json(await importCsv(sdb, await scopeOf(sdb, c.req.param("seriesId")), body));
});

/** Sửa/xoá theo id entry (cả 2 cấp) — rev tăng theo cấp của entry. */
glossaryRoutes.patch("/w/:ws/glossary/:entryId", requireWorkspace(), async (c) => {
  const body = await parseJson(c, EntryPatch);
  const row = await c.get("sdb").transaction(async (tx) => {
    const cur = await tx.byId(glossaryEntries, c.req.param("entryId"), "glossary entry");
    if (body.source_term !== undefined) await assertUniqueTerm(tx, cur.seriesId, body.source_term, cur.id);
    const [row] = await tx.update(glossaryEntries, eq(glossaryEntries.id, cur.id), {
      sourceTerm: body.source_term,
      targetTerm: body.target_term,
      note: body.note,
      caseSensitive: body.case_sensitive,
    });
    await bumpGlossaryRev(tx, cur.seriesId);
    return row ?? cur;
  });
  return c.json(entryView(row));
});

glossaryRoutes.delete("/w/:ws/glossary/:entryId", requireWorkspace(), async (c) => {
  await c.get("sdb").transaction(async (tx) => {
    const cur = await tx.byId(glossaryEntries, c.req.param("entryId"), "glossary entry");
    await tx.delete(glossaryEntries, eq(glossaryEntries.id, cur.id));
    await bumpGlossaryRev(tx, cur.seriesId);
  });
  return c.body(null, 204);
});
