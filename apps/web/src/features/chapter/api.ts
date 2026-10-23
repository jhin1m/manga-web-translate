/** Kiểu + gọi API của chương (khớp apps/api/src/routes/{chapters,pages,progress}.ts). */
import type { PageState, SourceSkipReason } from "@mtl/shared";
import { api, wsPath } from "../../lib/api.ts";
import type { ChapterStatus, ChapterSummary } from "../series/api.ts";
import type { Suggestion } from "./proofread-model.ts";
import type { PageStatus } from "./status.ts";

export type JobView = {
  id: string;
  type: string;
  status: string;
  progress: number;
  stage: string | null;
  attempts: number;
  provider_retries: number;
  error_class: string | null;
  error: string | null;
  run_after: string;
  page_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ChapterLock = { holder: string; holder_name: string | null; is_me: boolean; expires_at: string };

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
  detail: (ws: string, ch: string) => ["chapter", ws, ch] as const,
  progress: (ws: string, ch: string) => ["chapter", ws, ch, "progress"] as const,
  pages: (ws: string, ch: string, sig: string) => ["chapter", ws, ch, "pages", sig] as const,
  states: (ws: string, ch: string) => ["chapter", ws, ch, "states"] as const,
  sourceFiles: (ws: string, ch: string) => ["chapter", ws, ch, "source-files"] as const,
};

const base = (ws: string, ch: string, path = "") => wsPath(ws, `/chapters/${ch}${path}`);

export const fetchChapter = (ws: string, ch: string) => api<ChapterDetail>(base(ws, ch));
export const fetchProgress = (ws: string, ch: string) => api<Progress>(base(ws, ch, "/progress"));
export const fetchPages = (ws: string, ch: string) =>
  api<{ expires_at: string; pages: PageImage[] }>(base(ws, ch, "/pages"));
export type SourceFileImage = {
  id: string;
  ord: number;
  skip: SourceSkipReason | null;
  width: number | null;
  url: string;
};
export const fetchSourceFiles = (ws: string, ch: string) =>
  api<{ expires_at: string; files: SourceFileImage[] }>(base(ws, ch, "/source-files"));
/** Xoá (ẩn) / khôi phục 1 trang sau Bước 1 (cần giữ khoá; 409 khi chương đang chạy hoặc là trang cuối còn hiện). */
export const setPageSkip = (ws: string, pageId: string, skipped: boolean) =>
  api<{ id: string; skipped: boolean }>(wsPath(ws, `/pages/${pageId}`), { method: "PATCH", body: { skipped } });
/** Bỏ qua / dùng lại 1 ảnh gốc trước Bước 1 (chương chưa có page; 409 khi đã có page). */
export const setSourceSkip = (ws: string, ch: string, fileId: string, skip: "user" | null) =>
  api<ChapterDetail["source_files"][number]>(base(ws, ch, `/source-files/${fileId}`), {
    method: "PATCH",
    body: { skip },
  });
/** Đổi thứ tự ảnh gốc trước Bước 1: `ids` = cả bộ ảnh theo thứ tự mới (400 `source_set_mismatch` khi lệch bộ). */
export const setSourceOrder = (ws: string, ch: string, ids: string[]) =>
  api<{ source_files: ChapterDetail["source_files"] }>(base(ws, ch, "/source-files/order"), {
    method: "PUT",
    body: { ids },
  });
export const fetchChapterStates = (ws: string, ch: string) => api<{ pages: PageStateRow[] }>(base(ws, ch, "/states"));

export type Rejected = { id: string; ord: number; reason: "missing" | "too_large" | "type_mismatch" };
/** Đổi số chương / chuyển series (409 `chapter_number_taken` khi series đích đã có số đó). */
export const patchChapter = (ws: string, ch: string, body: { number?: string; series_id?: string }) =>
  api<ChapterSummary>(base(ws, ch), { method: "PATCH", body });
export const commitChapter = (ws: string, ch: string) =>
  api<{ job: JobView; accepted: number; rejected: Rejected[] }>(base(ws, ch, "/commit"), { method: "POST", body: {} });
/** Bước 2 "Dịch": chương xong bước 1 → dịch + chèn chữ các page đã OCR. */
export const translatePrepared = (ws: string, ch: string) =>
  api<{ job: JobView }>(base(ws, ch, "/translate-prepared"), { method: "POST" });
export const retryFailed = (ws: string, ch: string) =>
  api<{ jobs: JobView[] }>(base(ws, ch, "/retry-failed"), { method: "POST" });
export const retranslate = (ws: string, ch: string, pageIds?: string[]) =>
  api<{ job: JobView }>(base(ws, ch, "/translate"), { method: "POST", body: pageIds ? { page_ids: pageIds } : {} });
export type ProofreadView = { job: JobView | null; suggestions: Suggestion[] };
export const proofreadKey = (ws: string, ch: string) => ["chapter", ws, ch, "proofread"] as const;
export const fetchProofread = (ws: string, ch: string) => api<ProofreadView>(base(ws, ch, "/proofread"));
export const runProofread = (ws: string, ch: string) =>
  api<{ job: JobView; created: boolean }>(base(ws, ch, "/proofread"), { method: "POST" });
export const dismissSuggestion = (ws: string, id: string, dismissed = true) =>
  api<{ id: string; dismissed: boolean }>(wsPath(ws, `/proofread-suggestions/${id}`), {
    method: "PATCH",
    body: { dismissed },
  });

export const cancelChapter = (ws: string, ch: string) =>
  api<{ cancelled: number }>(base(ws, ch, "/cancel"), { method: "POST" });
export const lockChapter = (ws: string, ch: string) =>
  api<{ holder: string; expires_at: string }>(base(ws, ch, "/lock"), { method: "POST" });
export const unlockChapter = (ws: string, ch: string) => api<void>(base(ws, ch, "/lock"), { method: "DELETE" });

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
  list: (ws: string, ch: string) => ["chapter", ws, ch, "exports"] as const,
};
export const createExport = (ws: string, ch: string, body: ExportRequest) =>
  api<{ job: ExportView; created: boolean }>(base(ws, ch, "/export"), { method: "POST", body });
export const fetchExports = (ws: string, ch: string) => api<{ exports: ExportView[] }>(base(ws, ch, "/exports"));
export const cancelJob = (ws: string, jobId: string) =>
  api<unknown>(wsPath(ws, `/jobs/${jobId}/cancel`), { method: "POST" });

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

export const previewFindReplace = (ws: string, ch: string, body: FindReplaceInput) =>
  api<PreviewResult>(base(ws, ch, "/find-replace/preview"), { method: "POST", body });
export const applyFindReplace = (ws: string, ch: string, body: FindReplaceInput, versions: Record<string, number>) =>
  api<ApplyResult>(base(ws, ch, "/find-replace/apply"), { method: "POST", body: { ...body, versions } });
export const undoBatch = (ws: string, ch: string, batchId: string) =>
  api<{ pages: number }>(base(ws, ch, "/find-replace/undo"), { method: "POST", body: { batch_id: batchId } });
export const previewGlossaryApply = (ws: string, ch: string, rules: GlossaryRule[]) =>
  api<PreviewResult>(base(ws, ch, "/glossary-apply/preview"), { method: "POST", body: { rules } });
export const applyGlossaryRules = (ws: string, ch: string, rules: GlossaryRule[], versions: Record<string, number>) =>
  api<ApplyResult>(base(ws, ch, "/glossary-apply/apply"), { method: "POST", body: { rules, versions } });
