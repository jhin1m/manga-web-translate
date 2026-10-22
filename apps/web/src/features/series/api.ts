/** Kiểu + query của series (khớp apps/api/src/routes/series.ts). */
import type { PageFormat, SourceLang, TargetLang } from "@mtl/shared/series-lang";
import { api, wsPath } from "../../lib/api.ts";

export const FONT_IDS = [
  "Bangers-Regular",
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
  source_lang: SourceLang;
  target_lang: TargetLang;
  /** Cách commit chương: strip (ghép rồi cắt) hoặc pages (mỗi file 1 trang). */
  page_format: PageFormat;
  honorific_policy: "translate" | "keep";
  pronoun_rules: PronounRule[];
  style_prompt: string;
  default_fonts: Partial<Record<FontSlot, string>>;
  llm_tier: "standard" | "premium";
  /** Chữ bỏ qua (watermark, URL nhóm dịch) — vùng OCR chứa mục nào thì không dịch, không box. */
  ignore_text: string[];
};

export type Series = SeriesSettings & {
  id: string;
  title: string;
  glossary_rev: number;
  settings_rev: number;
  created_at: string;
  updated_at: string;
};

export type ChapterStatus = "draft" | "ingesting" | "processing" | "prepared" | "review" | "partial_failed" | "done";

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

/** Số page theo trạng thái (busy = mọi trạng thái chưa ready/failed). */
export type PageCounts = { total: number; ready: number; failed: number; busy: number };

/**
 * Chương kèm thống kê (series detail, recent-chapters, latest_chapter). `exported` = đã xuất và chưa sửa gì sau
 * đó; `reexport` = đã xuất nhưng sau đó có sửa tay / dịch lại → cần "Xuất lại".
 */
export type ChapterRow = ChapterSummary & { page_counts?: PageCounts; exported?: boolean; reexport?: boolean };

export type SeriesListItem = Series & {
  chapter_count: number;
  exported_count?: number;
  next_number?: string;
  latest_chapter?: ChapterRow | null;
  last_activity_at: string;
};
export type SeriesDetail = Series & { chapters: ChapterRow[] };

/** Chương mở của workspace (drawer Hoạt động): chương mình giữ khoá trước rồi updated_at mới nhất. */
export type RecentChapter = ChapterRow & { series_title: string; lock_holder_is_me: boolean };

export const seriesKeys = {
  list: (ws: string) => ["series", ws] as const,
  detail: (ws: string, id: string) => ["series", ws, id] as const,
  recent: (ws: string) => ["series", ws, "recent-chapters"] as const,
  skipImages: (ws: string, id: string) => ["series", ws, id, "skip-images"] as const,
};

export const fetchSeriesList = (ws: string) => api<{ series: SeriesListItem[] }>(wsPath(ws, "/series"));
export const fetchSeries = (ws: string, id: string) => api<SeriesDetail>(wsPath(ws, `/series/${id}`));
export const fetchRecentChapters = (ws: string, limit = 20) =>
  api<{ chapters: RecentChapter[] }>(wsPath(ws, `/recent-chapters?limit=${limit}&open=1`));
export const createSeries = (ws: string, body: { title: string } & Partial<SeriesSettings>) =>
  api<Series>(wsPath(ws, "/series"), { method: "POST", body });
export const patchSeries = (ws: string, id: string, body: Partial<SeriesSettings> & { title?: string }) =>
  api<Series>(wsPath(ws, `/series/${id}`), { method: "PATCH", body });
/** Xoá series cùng mọi chương + glossary riêng (admin trở lên). */
export const deleteSeries = (ws: string, id: string) => api<void>(wsPath(ws, `/series/${id}`), { method: "DELETE" });
/** Xoá hẳn chương (ảnh, bản dịch, lịch sử). Người khác đang mở sửa → 423 kèm `holder_name`. */
export const deleteChapter = (ws: string, id: string) => api<void>(wsPath(ws, `/chapters/${id}`), { method: "DELETE" });

/** Ảnh credit series đã học — chương tạo sau có ảnh khớp được bỏ qua sẵn. */
export type SkipImage = { id: string; width: number; height: number; url: string; created_at: string };
export const fetchSkipImages = (ws: string, seriesId: string) =>
  api<{ images: SkipImage[] }>(wsPath(ws, `/series/${seriesId}/skip-images`));
/** "Luôn bỏ ở series này": học 1 ảnh gốc, hoặc mọi ảnh gốc nằm trọn trong 1 trang. */
export const learnSkipImage = (ws: string, seriesId: string, from: { source_file_id: string } | { page_id: string }) =>
  api<{ learned: number; known: number }>(wsPath(ws, `/series/${seriesId}/skip-images`), {
    method: "POST",
    body: from,
  });
export const deleteSkipImage = (ws: string, seriesId: string, id: string) =>
  api<void>(wsPath(ws, `/series/${seriesId}/skip-images/${id}`), { method: "DELETE" });

/** Số chương gợi ý cho lần upload tiếp theo: lớn nhất + 1. */
export function nextChapterNumber(chapters: Pick<ChapterSummary, "number">[]): string {
  const max = chapters.reduce((m, c) => Math.max(m, Math.floor(Number(c.number) || 0)), 0);
  return String(max + 1);
}
