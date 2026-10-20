/**
 * Series + cài đặt dịch. Đổi trường ảnh hưởng dịch/typeset → `settings_rev + 1` (red team #3) — job enqueue
 * sau đó có input_rev mới, job cũ không bị dùng lại nhầm.
 */
import { chapters, series } from "@mtl/db";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { activeLockHolder } from "../lib/chapter-lock.ts";
import { parseJson } from "../lib/validate.ts";
import { type AppEnv, requireWorkspace } from "../middleware/workspace.ts";

/** Enum giữ đủ ngôn ngữ cho sau MVP; MVP chỉ bật KO → VI (red team #10). */
export const SOURCE_LANGS = ["ko", "ja", "zh", "en"] as const;
export const ENABLED_SOURCE_LANGS: readonly string[] = ["ko"];
export const TARGET_LANGS = ["vi"] as const;
export const HONORIFIC_POLICIES = ["translate", "keep"] as const;
export const LLM_TIERS = ["standard", "premium"] as const;
/** Font có trong worker/fonts/manifest.json (đủ dấu tiếng Việt). */
export const FONT_IDS = [
  "Anton-Regular",
  "Baloo2-Variable",
  "BeVietnamPro-Bold",
  "BeVietnamPro-Regular",
  "Itim-Regular",
  "Lexend-Variable",
  "Mali-Regular",
  "PatrickHand-Regular",
] as const;

const PronounRule = z.object({
  speaker: z.string().trim().min(1).max(80),
  listener: z.string().trim().min(1).max(80),
  /** VD "anh/em" — speaker xưng/gọi listener. */
  address: z.string().trim().min(1).max(120),
  note: z.string().trim().max(200).default(""),
});

const Settings = z.object({
  source_lang: z.enum(SOURCE_LANGS).refine((l) => ENABLED_SOURCE_LANGS.includes(l), "MVP chỉ hỗ trợ tiếng Hàn (ko)"),
  target_lang: z.enum(TARGET_LANGS),
  honorific_policy: z.enum(HONORIFIC_POLICIES),
  pronoun_rules: z.array(PronounRule).max(200),
  style_prompt: z.string().max(1000),
  default_fonts: z.object({ dialogue: z.enum(FONT_IDS), narration: z.enum(FONT_IDS), sfx: z.enum(FONT_IDS) }).partial(),
  llm_tier: z.enum(LLM_TIERS),
});

const SeriesCreate = Settings.partial().extend({ title: z.string().trim().min(1).max(200) });
const SeriesPatch = Settings.partial()
  .extend({ title: z.string().trim().min(1).max(200) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "không có trường nào để sửa");

type SeriesRow = typeof series.$inferSelect;
type ChapterRow = typeof chapters.$inferSelect;

export const seriesView = (s: SeriesRow) => ({
  id: s.id,
  title: s.title,
  source_lang: s.sourceLang,
  target_lang: s.targetLang,
  honorific_policy: s.honorificPolicy,
  pronoun_rules: s.pronounRules,
  style_prompt: s.stylePrompt,
  default_fonts: s.defaultFonts,
  // Cột DB mặc định "default" từ trước khi có tier → coi là standard.
  llm_tier: s.llmTier === "premium" ? "premium" : "standard",
  glossary_rev: s.glossaryRev,
  settings_rev: s.settingsRev,
  created_at: s.createdAt,
  updated_at: s.updatedAt,
});

export const chapterSummary = (ch: ChapterRow) => ({
  id: ch.id,
  series_id: ch.seriesId,
  number: ch.number,
  title: ch.title,
  status: ch.status,
  locked_by: activeLockHolder(ch),
  created_at: ch.createdAt,
  updated_at: ch.updatedAt,
});

/** Body API → cột DB; trả thêm cờ có trường ảnh hưởng dịch hay không. */
function toColumns(body: z.infer<typeof SeriesPatch>) {
  const set: Partial<typeof series.$inferInsert> = {};
  if (body.title !== undefined) set.title = body.title;
  if (body.source_lang !== undefined) set.sourceLang = body.source_lang;
  if (body.target_lang !== undefined) set.targetLang = body.target_lang;
  if (body.honorific_policy !== undefined) set.honorificPolicy = body.honorific_policy;
  if (body.pronoun_rules !== undefined) set.pronounRules = body.pronoun_rules;
  if (body.style_prompt !== undefined) set.stylePrompt = body.style_prompt;
  if (body.default_fonts !== undefined) set.defaultFonts = body.default_fonts;
  if (body.llm_tier !== undefined) set.llmTier = body.llm_tier;
  return set;
}

/** So với giá trị hiện tại — chỉ tăng rev khi trường dịch thực sự đổi (lưu form không đổi gì thì không). */
function translationChanged(cur: SeriesRow, set: Partial<typeof series.$inferInsert>): boolean {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const pairs: [unknown, unknown][] = [
    [set.sourceLang, cur.sourceLang],
    [set.targetLang, cur.targetLang],
    [set.honorificPolicy, cur.honorificPolicy],
    [set.pronounRules, cur.pronounRules],
    [set.stylePrompt, cur.stylePrompt],
    [set.defaultFonts, cur.defaultFonts],
    [set.llmTier, cur.llmTier === "premium" ? "premium" : "standard"],
  ];
  return pairs.some(([next, prev]) => next !== undefined && !same(next, prev));
}

export const seriesRoutes = new Hono<AppEnv>();

seriesRoutes.get("/w/:ws/series", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const [rows, chs] = await Promise.all([sdb.select(series), sdb.select(chapters)]);
  const count = new Map<string, number>();
  const last = new Map<string, Date>();
  for (const ch of chs) {
    count.set(ch.seriesId, (count.get(ch.seriesId) ?? 0) + 1);
    const prev = last.get(ch.seriesId);
    if (!prev || ch.updatedAt > prev) last.set(ch.seriesId, ch.updatedAt);
  }
  rows.sort((a, b) => (last.get(b.id) ?? b.updatedAt).getTime() - (last.get(a.id) ?? a.updatedAt).getTime());
  return c.json({
    series: rows.map((s) => ({
      ...seriesView(s),
      chapter_count: count.get(s.id) ?? 0,
      last_activity_at: last.get(s.id) ?? s.updatedAt,
    })),
  });
});

seriesRoutes.post("/w/:ws/series", requireWorkspace(), async (c) => {
  const body = await parseJson(c, SeriesCreate);
  const s = await c.get("sdb").insert(series, { llmTier: "standard", ...toColumns(body), title: body.title });
  return c.json(seriesView(s), 201);
});

seriesRoutes.get("/w/:ws/series/:seriesId", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const s = await sdb.byId(series, c.req.param("seriesId"), "series");
  const chs = await sdb.select(chapters, eq(chapters.seriesId, s.id));
  // numeric → so sánh số; cùng số thì mới nhất trước.
  chs.sort((a, b) => Number(a.number) - Number(b.number) || b.createdAt.getTime() - a.createdAt.getTime());
  return c.json({ ...seriesView(s), chapters: chs.map(chapterSummary) });
});

seriesRoutes.patch("/w/:ws/series/:seriesId", requireWorkspace(), async (c) => {
  const body = await parseJson(c, SeriesPatch);
  const sdb = c.get("sdb");
  const updated = await sdb.transaction(async (tx) => {
    const cur = await tx.byId(series, c.req.param("seriesId"), "series");
    const set = toColumns(body);
    // Tăng trong SQL (không từ giá trị đã đọc) → 2 lần lưu đồng thời không cùng ra một rev.
    if (translationChanged(cur, set)) set.settingsRev = sql`${series.settingsRev} + 1` as unknown as number;
    const [row] = await tx.update(series, eq(series.id, cur.id), set);
    if (!row) throw new HTTPException(404, { message: "series not found" });
    return row;
  });
  return c.json(seriesView(updated));
});
