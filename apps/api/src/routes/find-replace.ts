/**
 * Find/replace chữ thường (không regex) trong một chương và "áp lại glossary" vào bản dịch có sẵn (không gọi LLM).
 *
 * Luồng chung: preview (không cần khoá) → danh sách khớp + `versions` của các page bị ảnh hưởng → apply gửi lại
 * `versions` (bắt buộc đã xem trước): page đổi sau preview → 409 `preview_stale`. Apply cần khoá chương (423), chạy
 * 1 transaction: mỗi page ghi bản cũ vào `page_state_history` với chung `batch_id`, version +1. Hoàn tác = khôi phục
 * theo `batch_id`, chỉ khi các page chưa bị sửa tiếp (version hiện tại = version lúc áp + 1), không thì 409.
 *
 * Thay trong `region.translation` và `text_box.text`; box bị đổi có `lines: []` → renderer (editor + export) ngắt
 * lại theo typesetter (docs/typeset-layout-contract.md, trường `lines[]`).
 */
import { chapters, glossaryEntries, pageStateHistory, pageStates, pages, type Scoped, series } from "@mtl/db";
import type { PageState } from "@mtl/shared";
import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { assertChapterLock } from "../lib/chapter-lock.ts";
import { parseJson } from "../lib/validate.ts";
import { type AppEnv, requireWorkspace } from "../middleware/workspace.ts";
import { pruneHistory } from "./page-state.ts";

/** Trần danh sách khớp trả về (tổng `total` vẫn đếm đủ). */
export const MAX_PREVIEW_MATCHES = 1000;
const MAX_RULES = 200;

const Term = z
  .string()
  .max(200)
  .transform((s) => s.normalize("NFC"));
const FindBody = z.object({
  find: Term.refine((s) => s.trim().length > 0, "find rỗng"),
  replace: Term,
  case_sensitive: z.boolean().default(false),
});
const Versions = z.record(z.uuid(), z.number().int().nonnegative());
const GlossaryRule = z.object({
  source_term: z.string().trim().min(1).max(200),
  from: Term.refine((s) => s.trim().length > 0, "from rỗng"),
});
const GlossaryBody = z.object({ rules: z.array(GlossaryRule).min(1).max(MAX_RULES) });
const UndoBody = z.object({ batch_id: z.uuid() });

// ---- Thay thế thuần (test được không cần DB) ----

/** Một quy tắc thay: `find` → `replace`; `scope` (glossary) = chỉ vùng có source_text chứa term nguồn. */
export type ReplaceRule = {
  find: string;
  replace: string;
  caseSensitive: boolean;
  scope?: { sourceTerm: string; caseSensitive: boolean };
};

export type Match = {
  target: "box" | "region";
  id: string;
  before: string;
  after: string;
  count: number;
  rule: number;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const literal = (s: string, cs: boolean) => new RegExp(escapeRe(s), cs ? "gu" : "giu");

/** Thay mọi lần xuất hiện (chuỗi thường, không diễn giải `$`) → [chuỗi mới, số lần]. */
export function replaceLiteral(text: string, find: string, replace: string, cs: boolean): [string, number] {
  let n = 0;
  const out = text.replace(literal(find, cs), () => {
    n++;
    return replace;
  });
  // Ghép chuỗi NFC có thể ra chuỗi không NFC (dấu rời đứng đầu `replace`) → chuẩn hoá lại (schema PageState đòi NFC).
  return [n ? out.normalize("NFC") : out, n];
}

const contains = (text: string, term: string, cs: boolean) => literal(term, cs).test(text);

/**
 * Áp các quy tắc lên 1 page state → state mới + danh sách khớp (theo thứ tự quy tắc). Quy tắc có `scope` chỉ thay
 * trong vùng khớp term nguồn và các box gắn với vùng đó (region_id); không scope → mọi vùng + mọi box.
 */
export function applyRules(state: PageState, rules: ReplaceRule[]): { state: PageState; matches: Match[] } {
  const matches: Match[] = [];
  const regions = state.regions.map((r) => ({ ...r }));
  const boxes = state.text_boxes.map((b) => ({ ...b }));
  rules.forEach((rule, ri) => {
    const inScope = new Set(
      regions
        .filter((r) => !rule.scope || contains(r.source_text, rule.scope.sourceTerm, rule.scope.caseSensitive))
        .map((r) => r.id),
    );
    for (const r of regions) {
      if (!inScope.has(r.id)) continue;
      const [after, count] = replaceLiteral(r.translation, rule.find, rule.replace, rule.caseSensitive);
      if (count && after !== r.translation) {
        matches.push({ target: "region", id: r.id, before: r.translation, after, count, rule: ri });
        r.translation = after;
      }
    }
    for (const b of boxes) {
      if (rule.scope && !(b.region_id && inScope.has(b.region_id))) continue;
      const [after, count] = replaceLiteral(b.text, rule.find, rule.replace, rule.caseSensitive);
      if (count && after !== b.text) {
        matches.push({ target: "box", id: b.id, before: b.text, after, count, rule: ri });
        b.text = after;
        b.lines = []; // ngắt lại khi vẽ — dòng cũ không còn khớp text
      }
    }
  });
  return { state: { ...state, regions, text_boxes: boxes }, matches };
}

// ---- DB ----

type PageRow = { id: string; ord: number; version: number; state: PageState };

const httpError = (status: 404 | 409, body: Record<string, unknown>) =>
  new HTTPException(status, { res: Response.json(body, { status }) });

async function chapterPages(sdb: Scoped, chapterId: string): Promise<PageRow[]> {
  const ps = await sdb.select(pages, eq(pages.chapterId, chapterId));
  if (ps.length === 0) return [];
  const ord = new Map(ps.map((p) => [p.id, p.ord]));
  const states = await sdb.select(
    pageStates,
    inArray(
      pageStates.pageId,
      ps.map((p) => p.id),
    ),
  );
  return states
    .filter((s): s is typeof s & { state: PageState } => s.state !== null)
    .map((s) => ({ id: s.pageId, ord: ord.get(s.pageId) ?? 0, version: s.version, state: s.state }))
    .sort((a, b) => a.ord - b.ord);
}

function preview(rows: PageRow[], rules: ReplaceRule[]) {
  const matches: (Match & { page_id: string; ord: number })[] = [];
  const versions: Record<string, number> = {};
  for (const p of rows) {
    const r = applyRules(p.state, rules);
    if (!r.matches.length) continue;
    versions[p.id] = p.version;
    for (const m of r.matches) matches.push({ ...m, page_id: p.id, ord: p.ord });
  }
  const total = matches.reduce((n, m) => n + m.count, 0);
  return {
    matches: matches.slice(0, MAX_PREVIEW_MATCHES),
    total,
    truncated: matches.length > MAX_PREVIEW_MATCHES,
    versions,
  };
}

/** Ghi các page có khớp trong 1 transaction; page đổi so với preview (hoặc khớp mới xuất hiện) → 409. */
async function apply(
  sdb: Scoped,
  chapterId: string,
  userId: string,
  rules: ReplaceRule[],
  versions: Record<string, number>,
) {
  return sdb.transaction(async (tx) => {
    const rows = await chapterPages(tx, chapterId);
    const results = rows.map((p) => ({ p, r: applyRules(p.state, rules) })).filter((x) => x.r.matches.length);
    const stale = results.filter(({ p }) => versions[p.id] !== p.version).map(({ p }) => p.id);
    if (stale.length) throw httpError(409, { error: "preview_stale", pages: stale });
    const batchId = uuidv7();
    let replaced = 0;
    for (const { p, r } of results) {
      const [row] = await tx.update(
        pageStates,
        and(eq(pageStates.pageId, p.id), eq(pageStates.version, p.version)) as SQL,
        { state: r.state, version: p.version + 1, stateOrigin: "user", updatedBy: `user:${userId}` },
      );
      if (!row) throw httpError(409, { error: "preview_stale", pages: [p.id] });
      await tx.insert(pageStateHistory, {
        pageId: p.id,
        version: p.version,
        state: p.state,
        actor: `user:${userId}`,
        batchId,
      });
      await pruneHistory(tx, p.id);
      replaced += r.matches.reduce((n, m) => n + m.count, 0);
    }
    return { batch_id: batchId, pages: results.length, replaced };
  });
}

/** Khôi phục state trước batch; page đã bị sửa tiếp (hoặc đã hoàn tác) → 409, không ghi gì. */
async function undo(sdb: Scoped, chapterId: string, userId: string, batchId: string) {
  return sdb.transaction(async (tx) => {
    const own = new Set((await tx.select(pages, eq(pages.chapterId, chapterId))).map((p) => p.id));
    const hist = (await tx.select(pageStateHistory, eq(pageStateHistory.batchId, batchId))).filter((h) =>
      own.has(h.pageId),
    );
    if (hist.length === 0) throw httpError(404, { error: "batch_not_found" });
    const cur = new Map(
      (
        await tx.select(
          pageStates,
          inArray(
            pageStates.pageId,
            hist.map((h) => h.pageId),
          ),
        )
      ).map((s) => [s.pageId, s]),
    );
    const conflicts = hist.filter((h) => cur.get(h.pageId)?.version !== h.version + 1).map((h) => h.pageId);
    if (conflicts.length) throw httpError(409, { error: "undo_conflict", pages: conflicts });
    for (const h of hist) {
      const now = cur.get(h.pageId);
      if (!now) continue;
      const [row] = await tx.update(
        pageStates,
        and(eq(pageStates.pageId, h.pageId), eq(pageStates.version, now.version)) as SQL,
        { state: h.state, version: now.version + 1, stateOrigin: "user", updatedBy: `user:${userId}` },
      );
      if (!row) throw httpError(409, { error: "undo_conflict", pages: [h.pageId] });
      await tx.insert(pageStateHistory, {
        pageId: h.pageId,
        version: now.version,
        state: now.state,
        actor: `user:${userId}`,
      });
      await pruneHistory(tx, h.pageId);
    }
    return { pages: hist.length };
  });
}

/** Glossary đã gộp của series chương (entry series đè entry workspace) → quy tắc thay có phạm vi theo term nguồn. */
async function glossaryRules(
  sdb: Scoped,
  seriesId: string,
  body: z.infer<typeof GlossaryBody>,
): Promise<ReplaceRule[]> {
  const entries = await sdb.select(
    glossaryEntries,
    or(isNull(glossaryEntries.seriesId), eq(glossaryEntries.seriesId, seriesId)) as SQL,
  );
  const map = new Map<string, (typeof entries)[number]>();
  for (const e of [...entries].sort((a, b) => Number(a.seriesId !== null) - Number(b.seriesId !== null))) {
    map.set(e.sourceTerm, e);
  }
  const unknown = body.rules.filter((r) => !map.has(r.source_term)).map((r) => r.source_term);
  if (unknown.length) {
    throw new HTTPException(400, {
      res: Response.json({ error: "unknown_terms", terms: unknown }, { status: 400 }),
    });
  }
  return body.rules.map((r) => {
    const e = map.get(r.source_term) as (typeof entries)[number];
    return {
      find: r.from,
      replace: e.targetTerm.normalize("NFC"),
      caseSensitive: e.caseSensitive,
      scope: { sourceTerm: e.sourceTerm.normalize("NFC"), caseSensitive: e.caseSensitive },
    };
  });
}

const findRule = (b: z.infer<typeof FindBody>): ReplaceRule[] => [
  { find: b.find, replace: b.replace, caseSensitive: b.case_sensitive },
];

export const findReplaceRoutes = new Hono<AppEnv>();
const base = "/w/:ws/chapters/:chapterId";

findReplaceRoutes.post(`${base}/find-replace/preview`, requireWorkspace(), async (c) => {
  const body = await parseJson(c, FindBody);
  const sdb = c.get("sdb");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  return c.json(preview(await chapterPages(sdb, ch.id), findRule(body)));
});

findReplaceRoutes.post(`${base}/find-replace/apply`, requireWorkspace(), async (c) => {
  const body = await parseJson(c, FindBody.extend({ versions: Versions }));
  const sdb = c.get("sdb");
  const user = c.get("user");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  await assertChapterLock(sdb, ch.id, user.id);
  return c.json(await apply(sdb, ch.id, user.id, findRule(body), body.versions));
});

/** Hoàn tác 1 batch (find/replace hoặc áp glossary). */
findReplaceRoutes.post(`${base}/find-replace/undo`, requireWorkspace(), async (c) => {
  const body = await parseJson(c, UndoBody);
  const sdb = c.get("sdb");
  const user = c.get("user");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  await assertChapterLock(sdb, ch.id, user.id);
  return c.json(await undo(sdb, ch.id, user.id, body.batch_id));
});

findReplaceRoutes.post(`${base}/glossary-apply/preview`, requireWorkspace(), async (c) => {
  const body = await parseJson(c, GlossaryBody);
  const sdb = c.get("sdb");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  const s = await sdb.byId(series, ch.seriesId, "series");
  return c.json(preview(await chapterPages(sdb, ch.id), await glossaryRules(sdb, s.id, body)));
});

findReplaceRoutes.post(`${base}/glossary-apply/apply`, requireWorkspace(), async (c) => {
  const body = await parseJson(c, GlossaryBody.extend({ versions: Versions }));
  const sdb = c.get("sdb");
  const user = c.get("user");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  await assertChapterLock(sdb, ch.id, user.id);
  const s = await sdb.byId(series, ch.seriesId, "series");
  return c.json(await apply(sdb, ch.id, user.id, await glossaryRules(sdb, s.id, body), body.versions));
});
