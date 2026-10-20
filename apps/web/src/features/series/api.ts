/** Kiểu + query của series (khớp apps/api/src/routes/series.ts). */
import { api, wsPath } from "../../lib/api.ts";

export const FONT_IDS = [
  "PatrickHand-Regular",
  "BeVietnamPro-Regular",
  "BeVietnamPro-Bold",
  "Anton-Regular",
  "Baloo2-Variable",
  "Itim-Regular",
  "Lexend-Variable",
  "Mali-Regular",
] as const;

export type PronounRule = { speaker: string; listener: string; address: string; note: string };
export type FontSlot = "dialogue" | "narration" | "sfx";

export type SeriesSettings = {
  source_lang: "ko" | "ja" | "zh" | "en";
  target_lang: "vi";
  honorific_policy: "translate" | "keep";
  pronoun_rules: PronounRule[];
  style_prompt: string;
  default_fonts: Partial<Record<FontSlot, string>>;
  llm_tier: "standard" | "premium";
};

export type Series = SeriesSettings & {
  id: string;
  title: string;
  glossary_rev: number;
  settings_rev: number;
  created_at: string;
  updated_at: string;
};

export type ChapterStatus = "draft" | "ingesting" | "processing" | "review" | "partial_failed" | "done";

export type ChapterSummary = {
  id: string;
  series_id: string;
  number: string;
  title: string;
  status: ChapterStatus;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SeriesListItem = Series & { chapter_count: number; last_activity_at: string };
export type SeriesDetail = Series & { chapters: ChapterSummary[] };

export const seriesKeys = {
  list: (ws: string) => ["series", ws] as const,
  detail: (ws: string, id: string) => ["series", ws, id] as const,
};

export const fetchSeriesList = (ws: string) => api<{ series: SeriesListItem[] }>(wsPath(ws, "/series"));
export const fetchSeries = (ws: string, id: string) => api<SeriesDetail>(wsPath(ws, `/series/${id}`));
export const createSeries = (ws: string, body: { title: string } & Partial<SeriesSettings>) =>
  api<Series>(wsPath(ws, "/series"), { method: "POST", body });
export const patchSeries = (ws: string, id: string, body: Partial<SeriesSettings> & { title?: string }) =>
  api<Series>(wsPath(ws, `/series/${id}`), { method: "PATCH", body });

/** Số chương gợi ý cho lần upload tiếp theo: lớn nhất + 1. */
export function nextChapterNumber(chapters: Pick<ChapterSummary, "number">[]): string {
  const max = chapters.reduce((m, c) => Math.max(m, Math.floor(Number(c.number) || 0)), 0);
  return String(max + 1);
}
