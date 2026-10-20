/** Kiểu + gọi API editor (khớp apps/api/src/routes/page-state.ts và routes/jobs.ts). */
import type { PageState, Region } from "@mtl/shared";
import { api, wsPath } from "../../lib/api.ts";
import type { JobView } from "../chapter/api.ts";

export type EditorPage = {
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

const page = (ws: string, id: string, path = "") => wsPath(ws, `/pages/${id}${path}`);

export const editorKeys = { page: (ws: string, id: string) => ["editor", ws, id] as const };

export const fetchEditorPage = (ws: string, id: string) => api<EditorPage>(page(ws, id));

export const putPageState = (ws: string, id: string, state: PageState, version: number) =>
  api<{ version: number }>(page(ws, id, "/state"), {
    method: "PUT",
    body: { state },
    headers: { "if-match": `"${version}"` },
  });

export const ackAiUpdate = (ws: string, id: string, aiRev: number) =>
  api<{ ai_rev: number; ai_update_available: boolean }>(page(ws, id, "/ai-update/ack"), {
    method: "POST",
    body: { ai_rev: aiRev },
  });

export const requestMaskUpload = (ws: string, id: string) =>
  api<{ key: string; url: string; fields: Record<string, string> }>(page(ws, id, "/mask-upload"), { method: "POST" });

export const startReinpaint = (
  ws: string,
  id: string,
  body: { user_mask_key: string; offset: [number, number]; base_clean_rev: number },
) => api<{ job: JobWithResult }>(page(ws, id, "/reinpaint"), { method: "POST", body });

export const startOcrRegion = (ws: string, id: string, bbox: [number, number, number, number]) =>
  api<{ job: JobWithResult }>(page(ws, id, "/ocr-region"), { method: "POST", body: { bbox } });

export const fetchJob = (ws: string, jobId: string) => api<JobWithResult>(wsPath(ws, `/jobs/${jobId}`));

const DONE = new Set(["succeeded", "failed", "cancelled"]);

/** Poll job tới khi kết thúc (hoặc `signal` huỷ). */
export async function waitJob(ws: string, jobId: string, signal?: AbortSignal, everyMs = 1500): Promise<JobWithResult> {
  for (;;) {
    signal?.throwIfAborted();
    const j = await fetchJob(ws, jobId);
    if (DONE.has(j.status)) return j;
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
