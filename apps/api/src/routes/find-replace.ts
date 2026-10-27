/**
 * Find/replace chữ thường (không regex) trong một chương và "áp lại glossary" vào bản dịch có sẵn (không gọi LLM).
 *
 * Luồng chung (lõi ở lib/batch-edit.ts): preview (không cần khoá) → apply gửi lại `versions` (bắt buộc đã xem trước,
 * page đổi sau preview → 409 `preview_stale`) → hoàn tác theo `batch_id` (409 nếu page đã bị sửa tiếp). Apply và hoàn
 * tác cần khoá chương (423).
 *
 * Thay trong `region.translation` và `text_box.text`; box bị đổi có `lines: []` → renderer (editor + export) ngắt
 * lại theo typesetter (docs/typeset-layout-contract.md, trường `lines[]`).
 */
import { chapters, glossaryEntries, type Scoped, series } from "@mtl/db";
import type { PageState } from "@mtl/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { applyBatch, chapterPages, httpError, previewPages, undoBatch } from "../lib/batch-edit.ts";
import { assertChapterLock } from "../lib/chapter-lock.ts";
import { mergeBySourceTerm, seriesGlossaryWhere } from "../lib/glossary-scope.ts";
import { parseJson } from "../lib/validate.ts";
import type { AppEnv } from "../middleware/user.ts";

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

/** Glossary đã gộp của series chương (entry series đè entry chung đúng cặp) → quy tắc thay có phạm vi theo term nguồn. */
async function glossaryRules(
  sdb: Scoped,
  s: typeof series.$inferSelect,
  body: z.infer<typeof GlossaryBody>,
): Promise<ReplaceRule[]> {
  const map = mergeBySourceTerm(await sdb.select(glossaryEntries, seriesGlossaryWhere(s)));
  const unknown = body.rules.filter((r) => !map.has(r.source_term)).map((r) => r.source_term);
  if (unknown.length) {
    throw new HTTPException(400, {
      res: Response.json({ error: "unknown_terms", terms: unknown }, { status: 400 }),
    });
  }
  return body.rules.map((r) => {
    const e = map.get(r.source_term) as typeof glossaryEntries.$inferSelect;
    return {
      find: r.from,
      replace: e.targetTerm.normalize("NFC"),
      caseSensitive: e.caseSensitive,
      scope: { sourceTerm: e.sourceTerm.normalize("NFC"), caseSensitive: e.caseSensitive },
    };
  });
}

/** Quy tắc thay → phép sửa page của lõi sửa hàng loạt. */
const transformOf = (rules: ReplaceRule[]) => (state: PageState) => applyRules(state, rules);

/** Apply của find/replace + glossary: `replaced` = số chỗ đã thay. */
async function applyRulesToChapter(
  sdb: Scoped,
  chapterId: string,
  userId: string,
  rules: ReplaceRule[],
  versions: Record<string, number>,
) {
  const { changed, ...rest } = await applyBatch(sdb, chapterId, userId, transformOf(rules), versions);
  return { ...rest, replaced: changed };
}

const findRule = (b: z.infer<typeof FindBody>): ReplaceRule[] => [
  { find: b.find, replace: b.replace, caseSensitive: b.case_sensitive },
];

export const findReplaceRoutes = new Hono<AppEnv>();
const base = "/chapters/:chapterId";

findReplaceRoutes.post(`${base}/find-replace/preview`, async (c) => {
  const body = await parseJson(c, FindBody);
  const sdb = c.get("sdb");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  return c.json(previewPages(await chapterPages(sdb, ch.id), transformOf(findRule(body))));
});

findReplaceRoutes.post(`${base}/find-replace/apply`, async (c) => {
  const body = await parseJson(c, FindBody.extend({ versions: Versions }));
  const sdb = c.get("sdb");
  const user = c.get("user");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  await assertChapterLock(sdb, ch.id, c.get("lockHolder"));
  return c.json(await applyRulesToChapter(sdb, ch.id, user.id, findRule(body), body.versions));
});

/** Hoàn tác 1 batch (find/replace hoặc áp glossary). */
findReplaceRoutes.post(`${base}/find-replace/undo`, async (c) => {
  const body = await parseJson(c, UndoBody);
  const sdb = c.get("sdb");
  const user = c.get("user");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  await assertChapterLock(sdb, ch.id, c.get("lockHolder"));
  const r = await undoBatch(sdb, ch.id, user.id, body.batch_id, "fail");
  if (!r.found) throw httpError(404, { error: "batch_not_found" });
  return c.json({ pages: r.restored });
});

findReplaceRoutes.post(`${base}/glossary-apply/preview`, async (c) => {
  const body = await parseJson(c, GlossaryBody);
  const sdb = c.get("sdb");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  const s = await sdb.byId(series, ch.seriesId, "series");
  return c.json(previewPages(await chapterPages(sdb, ch.id), transformOf(await glossaryRules(sdb, s, body))));
});

findReplaceRoutes.post(`${base}/glossary-apply/apply`, async (c) => {
  const body = await parseJson(c, GlossaryBody.extend({ versions: Versions }));
  const sdb = c.get("sdb");
  const user = c.get("user");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  await assertChapterLock(sdb, ch.id, c.get("lockHolder"));
  const s = await sdb.byId(series, ch.seriesId, "series");
  return c.json(await applyRulesToChapter(sdb, ch.id, user.id, await glossaryRules(sdb, s, body), body.versions));
});
