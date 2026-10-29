/** Kiểu + gọi API của chương (khớp apps/api/src/routes/{chapters,pages,progress}.ts). */
import type { PageState, SourceSkipReason } from "@mtl/shared";
import { api } from "../../lib/api.ts";
import type { ChapterStatus, ChapterSummary } from "../series/api.ts";
import type { Suggestion } from "./proofread-model.ts";
import type { PageStatus } from "./status.ts";

export type JobView = {
  id: string;
  type: string;
  status: string;
  progress: number;
  stage: string | null;
  /** Số ảnh/trang/đoạn đã xong / tổng của bước `stage` (null = bước không đếm) — xem `stage-labels.ts`. */
  progress_done: number | null;
  progress_total: number | null;
  attempts: number;
  provider_retries: number;
  error_class: string | null;
  error: string | null;
  run_after: string;
  page_id: string | null;
  created_at: string;
  updated_at: string;
};

/** Khoá chương còn hạn (tab nào giữ không lộ ra — tab này biết mình giữ qua POST /lock). */
export type ChapterLock = { expires_at: string };

export type ChapterDetail = ChapterSummary & {
  ingest_rev: number;
  series: { id: string; title: string };
  lock: ChapterLock | null;
  source_files: { id: string; ord: number; bytes: number; mime: string; skip: SourceSkipReason | null }[];
};

export type ProgressPage = {
  id: string;
  ord: number;
  status: PageStatus;
  width: number;
  height: number;
  clean_rev: number | null;
  cut_flag: boolean;
  /** Người dùng đã xoá (ẩn) trang — không dịch, không xuất, khôi phục được. */
  skipped: boolean;
  ai_update_available: boolean;
  version: number;
  job: JobView | null;
};

export type Progress = {
  chapter: { id: string; status: ChapterStatus; ingest_rev: number };
  counts: Partial<Record<PageStatus, number>>;
  pages: ProgressPage[];
  jobs: JobView[];
};

export type PageImage = {
  id: string;
  ord: number;
  width: number;
  height: number;
  clean_rev: number | null;
  image: { kind: "clean" | "original"; url: string };
  /** Ảnh gốc + ảnh sạch (null khi chưa xoá chữ) cho canvas màn chương. */
  images: { original: string; clean: string | null };
};

/** State của 1 page trong `GET /chapters/:id/states` (không kèm ai_state). */
export type PageStateRow = {
  page_id: string;
  ord: number;
  version: number;
  state: PageState | null;
  state_origin: "ai" | "user";
  ai_rev: number;
  ai_update_available: boolean;
};

export const chapterKeys = {
  detail: (ch: string) => ["chapter", ch] as const,
  progress: (ch: string) => ["chapter", ch, "progress"] as const,
  pages: (ch: string, sig: string) => ["chapter", ch, "pages", sig] as const,
  states: (ch: string) => ["chapter", ch, "states"] as const,
  sourceFiles: (ch: string) => ["chapter", ch, "source-files"] as const,
};

const base = (ch: string, path = "") => `/api/chapters/${ch}${path}`;

export const fetchChapter = (ch: string) => api<ChapterDetail>(base(ch));
export const fetchProgress = (ch: string) => api<Progress>(base(ch, "/progress"));
export const fetchPages = (ch: string) => api<{ expires_at: string; pages: PageImage[] }>(base(ch, "/pages"));
export type SourceFileImage = {
  id: string;
  ord: number;
  skip: SourceSkipReason | null;
  width: number | null;
  url: string;
};
export const fetchSourceFiles = (ch: string) =>
  api<{ expires_at: string; files: SourceFileImage[] }>(base(ch, "/source-files"));
/** Xoá (ẩn) / khôi phục 1 trang sau Bước 1 (cần giữ khoá; 409 khi chương đang chạy hoặc là trang cuối còn hiện). */
export const setPageSkip = (pageId: string, skipped: boolean) =>
  api<{ id: string; skipped: boolean }>(`/api/pages/${pageId}`, { method: "PATCH", body: { skipped } });
/** Bỏ qua / dùng lại 1 ảnh gốc trước Bước 1 (chương chưa có page; 409 khi đã có page). */
export const setSourceSkip = (ch: string, fileId: string, skip: "user" | null) =>
  api<ChapterDetail["source_files"][number]>(base(ch, `/source-files/${fileId}`), {
    method: "PATCH",
    body: { skip },
  });
/** Đổi thứ tự ảnh gốc trước Bước 1: `ids` = cả bộ ảnh theo thứ tự mới (400 `source_set_mismatch` khi lệch bộ). */
export const setSourceOrder = (ch: string, ids: string[]) =>
  api<{ source_files: ChapterDetail["source_files"] }>(base(ch, "/source-files/order"), {
    method: "PUT",
    body: { ids },
  });
export const fetchChapterStates = (ch: string) => api<{ pages: PageStateRow[] }>(base(ch, "/states"));

export type Rejected = { id: string; ord: number; reason: "missing" | "too_large" | "type_mismatch" };
/** Đổi số chương / chuyển series (409 `chapter_number_taken` khi series đích đã có số đó). */
export const patchChapter = (ch: string, body: { number?: string; series_id?: string }) =>
  api<ChapterSummary>(base(ch), { method: "PATCH", body });
export const commitChapter = (ch: string) =>
  api<{ job: JobView; accepted: number; rejected: Rejected[] }>(base(ch, "/commit"), { method: "POST", body: {} });
/** Bước 2 "Dịch": chương xong bước 1 → dịch + chèn chữ các page đã OCR. */
export const translatePrepared = (ch: string) =>
  api<{ job: JobView }>(base(ch, "/translate-prepared"), { method: "POST" });
export const retryFailed = (ch: string) => api<{ jobs: JobView[] }>(base(ch, "/retry-failed"), { method: "POST" });
export const retranslate = (ch: string, pageIds?: string[]) =>
  api<{ job: JobView }>(base(ch, "/translate"), { method: "POST", body: pageIds ? { page_ids: pageIds } : {} });
export type ProofreadView = { job: JobView | null; suggestions: Suggestion[] };
export const proofreadKey = (ch: string) => ["chapter", ch, "proofread"] as const;
export const fetchProofread = (ch: string) => api<ProofreadView>(base(ch, "/proofread"));
export const runProofread = (ch: string) =>
  api<{ job: JobView; created: boolean }>(base(ch, "/proofread"), { method: "POST" });
export const dismissSuggestion = (id: string, dismissed = true) =>
  api<{ id: string; dismissed: boolean }>(`/api/proofread-suggestions/${id}`, {
    method: "PATCH",
    body: { dismissed },
  });

export const cancelChapter = (ch: string) => api<{ cancelled: number }>(base(ch, "/cancel"), { method: "POST" });
export const lockChapter = (ch: string) => api<{ expires_at: string }>(base(ch, "/lock"), { method: "POST" });
export const unlockChapter = (ch: string) => api<void>(base(ch, "/lock"), { method: "DELETE" });

export const REJECT_REASON: Record<Rejected["reason"], string> = {
  missing: "chưa upload xong",
  too_large: "vượt 30MB",
  type_mismatch: "nội dung không phải ảnh khớp đuôi file",
};

// ---- Export ----
export type ExportFormat = "png_zip" | "cbz";
export type ExportLayout = "original_slices" | "pages";
export type ExportStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "paused_budget";
export type ExportView = {
  id: string;
  status: ExportStatus;
  progress: number;
  stage: string | null;
  error: string | null;
  format: ExportFormat;
  layout: ExportLayout;
  quality: number;
  include_untranslated: boolean;
  bytes: number | null;
  created_at: string;
  expires_at: string | null;
  download_url: string | null;
};
export type ExportRequest = {
  format: ExportFormat;
  layout: ExportLayout;
  quality?: number;
  include_untranslated?: boolean;
};

export const exportKeys = {
  list: (ch: string) => ["chapter", ch, "exports"] as const,
};
export const createExport = (ch: string, body: ExportRequest) =>
  api<{ job: ExportView; created: boolean }>(base(ch, "/export"), { method: "POST", body });
export const fetchExports = (ch: string) => api<{ exports: ExportView[] }>(base(ch, "/exports"));
export const cancelJob = (jobId: string) => api<unknown>(`/api/jobs/${jobId}/cancel`, { method: "POST" });

// ---- Find/replace + áp lại glossary (cùng dạng preview/apply/undo) ----
export type MatchTarget = "box" | "region";
export type FindMatch = {
  page_id: string;
  ord: number;
  target: MatchTarget;
  id: string;
  before: string;
  after: string;
  count: number;
  /** Chỉ có ở áp glossary: chỉ số rule trong request. */
  rule?: number;
};
export type PreviewResult = {
  matches: FindMatch[];
  total: number;
  truncated: boolean;
  versions: Record<string, number>;
};
export type ApplyResult = { batch_id: string; pages: number; replaced: number };

export type FindReplaceInput = { find: string; replace: string; case_sensitive: boolean };
export type GlossaryRule = { source_term: string; from: string };

export const previewFindReplace = (ch: string, body: FindReplaceInput) =>
  api<PreviewResult>(base(ch, "/find-replace/preview"), { method: "POST", body });
export const applyFindReplace = (ch: string, body: FindReplaceInput, versions: Record<string, number>) =>
  api<ApplyResult>(base(ch, "/find-replace/apply"), { method: "POST", body: { ...body, versions } });
export const undoBatch = (ch: string, batchId: string) =>
  api<{ pages: number }>(base(ch, "/find-replace/undo"), { method: "POST", body: { batch_id: batchId } });
export const previewGlossaryApply = (ch: string, rules: GlossaryRule[]) =>
  api<PreviewResult>(base(ch, "/glossary-apply/preview"), { method: "POST", body: { rules } });
export const applyGlossaryRules = (ch: string, rules: GlossaryRule[], versions: Record<string, number>) =>
  api<ApplyResult>(base(ch, "/glossary-apply/apply"), { method: "POST", body: { rules, versions } });
