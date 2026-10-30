/** Kiểu + gọi API editor (khớp apps/api/src/routes/page-state.ts và routes/jobs.ts). */
import type { PageState, Region } from "@mtl/shared";
import { api } from "../../lib/api.ts";
import type { JobView } from "../chapter/api.ts";

export type PageDetail = {
  page: {
    id: string;
    chapter_id: string;
    ord: number;
    width: number;
    height: number;
    status: string;
    clean_rev: number | null;
  };
  version: number;
  state: PageState | null;
  state_origin: "ai" | "user";
  ai_state: PageState | null;
  ai_rev: number;
  ai_update_available: boolean;
  images: { original: string; clean: string | null };
  expires_at: string;
};

export type JobWithResult = JobView & { result: unknown };

const page = (id: string, path = "") => `/api/pages/${id}${path}`;

export const fetchPageDetail = (id: string) => api<PageDetail>(page(id));

export const putPageState = (id: string, state: PageState, version: number) =>
  api<{ version: number }>(page(id, "/state"), {
    method: "PUT",
    body: { state },
    headers: { "if-match": `"${version}"` },
  });

/** Ghi state nhiều page của chương trong 1 lượt (chung batch_id → hoàn tác bằng undoBatch). */
export const putChapterStates = (chapterId: string, pages: { page_id: string; version: number; state: PageState }[]) =>
  api<{ batch_id: string; versions: Record<string, number> }>(`/api/chapters/${chapterId}/states`, {
    method: "PUT",
    body: { pages },
  });

export const ackAiUpdate = (id: string, aiRev: number) =>
  api<{ ai_rev: number; ai_update_available: boolean }>(page(id, "/ai-update/ack"), {
    method: "POST",
    body: { ai_rev: aiRev },
  });

export const requestMaskUpload = (id: string) =>
  api<{ key: string; url: string; fields: Record<string, string> }>(page(id, "/mask-upload"), { method: "POST" });

export const startReinpaint = (
  id: string,
  body: { user_mask_key: string; offset: [number, number]; base_clean_rev: number },
) => api<{ job: JobWithResult }>(page(id, "/reinpaint"), { method: "POST", body });

export const startOcrRegion = (id: string, bbox: [number, number, number, number]) =>
  api<{ job: JobWithResult }>(page(id, "/ocr-region"), { method: "POST", body: { bbox } });

export const fetchJob = (jobId: string) => api<JobWithResult>(`/api/jobs/${jobId}`);

const DONE = new Set(["succeeded", "failed", "cancelled"]);

/** Poll job tới khi kết thúc (hoặc `signal` huỷ). */
export async function waitJob(
  jobId: string,
  signal?: AbortSignal,
  everyMs = 1500,
  onPoll?: (j: JobWithResult) => void,
): Promise<JobWithResult> {
  for (;;) {
    signal?.throwIfAborted();
    const j = await fetchJob(jobId);
    if (DONE.has(j.status)) return j;
    onPoll?.(j);
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      };
      const t = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, everyMs);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

/** Upload mask PNG qua presigned POST (Content-Type cố định trong policy). */
export async function uploadMask(post: { url: string; fields: Record<string, string> }, png: Blob) {
  const form = new FormData();
  for (const [k, v] of Object.entries(post.fields)) form.append(k, v);
  form.append("file", png);
  const res = await fetch(post.url, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload mask thất bại (${res.status})`);
}

export type OcrRegionResult = { type: "page.ocr_region"; region: Region };
