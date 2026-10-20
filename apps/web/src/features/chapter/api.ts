/** Kiểu + gọi API của chương (khớp apps/api/src/routes/{chapters,pages,progress}.ts). */
import { api, wsPath } from "../../lib/api.ts";
import type { ChapterStatus, ChapterSummary } from "../series/api.ts";
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
  page_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ChapterLock = { holder: string; holder_name: string | null; is_me: boolean; expires_at: string };

export type ChapterDetail = ChapterSummary & {
  ingest_rev: number;
  series: { id: string; title: string };
  lock: ChapterLock | null;
  source_files: { id: string; ord: number; bytes: number; mime: string }[];
};

export type ProgressPage = {
  id: string;
  ord: number;
  status: PageStatus;
  width: number;
  height: number;
  clean_rev: number | null;
  cut_flag: boolean;
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
};

export const chapterKeys = {
  detail: (ws: string, ch: string) => ["chapter", ws, ch] as const,
  progress: (ws: string, ch: string) => ["chapter", ws, ch, "progress"] as const,
  pages: (ws: string, ch: string, sig: string) => ["chapter", ws, ch, "pages", sig] as const,
};

const base = (ws: string, ch: string, path = "") => wsPath(ws, `/chapters/${ch}${path}`);

export const fetchChapter = (ws: string, ch: string) => api<ChapterDetail>(base(ws, ch));
export const fetchProgress = (ws: string, ch: string) => api<Progress>(base(ws, ch, "/progress"));
export const fetchPages = (ws: string, ch: string) =>
  api<{ expires_at: string; pages: PageImage[] }>(base(ws, ch, "/pages"));

export type Rejected = { id: string; ord: number; reason: "missing" | "too_large" | "type_mismatch" };
export const commitChapter = (ws: string, ch: string) =>
  api<{ job: JobView; accepted: number; rejected: Rejected[] }>(base(ws, ch, "/commit"), { method: "POST", body: {} });
export const retryFailed = (ws: string, ch: string) =>
  api<{ jobs: JobView[] }>(base(ws, ch, "/retry-failed"), { method: "POST" });
export const retranslate = (ws: string, ch: string, pageIds?: string[]) =>
  api<{ job: JobView }>(base(ws, ch, "/translate"), { method: "POST", body: pageIds ? { page_ids: pageIds } : {} });
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
