/** Kiểu + query của series (khớp apps/api/src/routes/series.ts). */
import type { PageFormat, SourceLang, TargetLang } from "@mtl/shared/series-lang";
import { api } from "../../lib/api.ts";

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
  /** Đang mở sửa ở một tab (khoá còn hạn). */
  locked: boolean;
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

/** Chương mở (drawer Hoạt động): chương đang mở sửa trước rồi updated_at mới nhất. */
export type RecentChapter = ChapterRow & { series_title: string };

export const seriesKeys = {
  list: () => ["series"] as const,
  detail: (id: string) => ["series", id] as const,
  recent: () => ["series", "recent-chapters"] as const,
  skipImages: (id: string) => ["series", id, "skip-images"] as const,
};

export const fetchSeriesList = () => api<{ series: SeriesListItem[] }>("/api/series");
export const fetchSeries = (id: string) => api<SeriesDetail>(`/api/series/${id}`);
export const fetchRecentChapters = (limit = 20) =>
  api<{ chapters: RecentChapter[] }>(`/api/recent-chapters?limit=${limit}&open=1`);
export const createSeries = (body: { title: string } & Partial<SeriesSettings>) =>
  api<Series>("/api/series", { method: "POST", body });
export const patchSeries = (id: string, body: Partial<SeriesSettings> & { title?: string }) =>
  api<Series>(`/api/series/${id}`, { method: "PATCH", body });
/** Xoá series cùng mọi chương + glossary riêng. */
export const deleteSeries = (id: string) => api<void>(`/api/series/${id}`, { method: "DELETE" });
/** Xoá hẳn chương (ảnh, bản dịch, lịch sử). Đang mở sửa ở tab khác → 423. */
export const deleteChapter = (id: string) => api<void>(`/api/chapters/${id}`, { method: "DELETE" });

/** Ảnh credit series đã học — chương tạo sau có ảnh khớp được bỏ qua sẵn. */
export type SkipImage = { id: string; width: number; height: number; url: string; created_at: string };
export const fetchSkipImages = (seriesId: string) =>
  api<{ images: SkipImage[] }>(`/api/series/${seriesId}/skip-images`);
/** "Luôn bỏ ở series này": học 1 ảnh gốc, hoặc mọi ảnh gốc nằm trọn trong 1 trang. */
export const learnSkipImage = (seriesId: string, from: { source_file_id: string } | { page_id: string }) =>
  api<{ learned: number; known: number }>(`/api/series/${seriesId}/skip-images`, {
    method: "POST",
    body: from,
  });
export const deleteSkipImage = (seriesId: string, id: string) =>
  api<void>(`/api/series/${seriesId}/skip-images/${id}`, { method: "DELETE" });

/** Ẩn box khớp chữ bỏ qua trong chương đã dịch (xem trước → áp dụng → hoàn tác theo batch_id). */
type ChapterRef = { chapter_id: string; number: string; title: string };
export type IgnoreSkipReason = "locked" | "busy" | "changed";
export type IgnorePreview = {
  chapters: (ChapterRef & { boxes: number; pages: number; samples: string[]; versions: Record<string, number> })[];
  skipped: (ChapterRef & { reason: IgnoreSkipReason })[];
  total_boxes: number;
};
export type IgnoreApplied = {
  batch_id: string | null;
  boxes: number;
  chapters: (ChapterRef & { boxes: number; pages: number })[];
  skipped: (ChapterRef & { reason: IgnoreSkipReason })[];
};
export type IgnoreUndone = {
  pages: number;
  chapters: (ChapterRef & { pages: number })[];
  skipped: (ChapterRef & { reason: IgnoreSkipReason; pages: number })[];
};
const ignoreApply = (seriesId: string, step: string) => `/api/series/${seriesId}/ignore-apply/${step}`;
export const previewIgnoreApply = (seriesId: string) =>
  api<IgnorePreview>(ignoreApply(seriesId, "preview"), { method: "POST", body: {} });
export const applyIgnoreApply = (seriesId: string, versions: Record<string, number>) =>
  api<IgnoreApplied>(ignoreApply(seriesId, "apply"), { method: "POST", body: { versions } });
export const undoIgnoreApply = (seriesId: string, batchId: string) =>
  api<IgnoreUndone>(ignoreApply(seriesId, "undo"), { method: "POST", body: { batch_id: batchId } });

/** Số chương gợi ý cho lần upload tiếp theo: lớn nhất + 1. */
export function nextChapterNumber(chapters: Pick<ChapterSummary, "number">[]): string {
  const max = chapters.reduce((m, c) => Math.max(m, Math.floor(Number(c.number) || 0)), 0);
  return String(max + 1);
}
