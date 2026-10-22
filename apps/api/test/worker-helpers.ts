/** Worker giả lập trong test: gọi đúng giao thức HTTP có fencing, upload output thật qua presigned PUT. */
import { chapters, jobs, pages, scoped, sourceFiles, workspaceSettings } from "@mtl/db";
import { emptyPageState, type JobResult, type PageState, storageKeys, type WorkerUsage } from "@mtl/shared";
import { eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { inJobTx, translatePrepared } from "../src/jobs/enqueue.ts";
import { createWorkerToken } from "../src/lib/worker-token.ts";
import { app, db } from "./helpers.ts";

/** PNG 1×1 hợp lệ. */
export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
export const SHA = "ab".repeat(32);
export const VERSION = "0.4.2";

export type Claimed = {
  id: string;
  type: string;
  attempt: number;
  lease_token: string;
  lease_expires_at: string;
  payload: Record<string, unknown> & { type: string };
  inputs: Record<string, unknown>;
  outputs: Record<string, { key: string; rev: number | null; put: string }>;
};

export async function workerToken(workspaceId: string | null, name = "test-worker", capabilities: string[] = []) {
  const { id, token } = await createWorkerToken({ name, workspaceId, capabilities });
  return { id, token };
}

export function wcall(token: string, path: string, body?: unknown) {
  return app.request(`/worker/v1${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const ALL_CAPS = ["chapter.ingest", "page.prepare", "chapter.translate", "page.reinpaint", "page.ocr_region"];

export async function claimJobs(token: string, opts: { max?: number; caps?: string[]; version?: string } = {}) {
  const res = await wcall(token, "/claim", {
    worker_id: "test",
    capabilities: opts.caps ?? ALL_CAPS,
    max: opts.max ?? 1,
    pipeline_version: opts.version ?? VERSION,
    dispatch_id: null,
  });
  if (res.status !== 200) throw new Error(`claim ${res.status} ${await res.text()}`);
  return ((await res.json()) as { jobs: Claimed[] }).jobs;
}

export async function putPng(url: string) {
  const res = await fetch(url, { method: "PUT", body: PNG_1PX, headers: { "content-type": "image/png" } });
  if (!res.ok) throw new Error(`PUT ${res.status} ${await res.text()}`);
}

export const fence = (j: Claimed) => ({ lease_token: j.lease_token, attempt: j.attempt });

export function usage(seq: number, over: Partial<WorkerUsage> = {}): WorkerUsage {
  return { seq, model: "gemini-2.5-flash", llm_in: 1000, llm_out: 200, calls: 1, gpu_s: 0, ...over };
}

export function complete(token: string, j: Claimed, result: JobResult, u: WorkerUsage | null = null) {
  return wcall(token, `/jobs/${j.id}/complete`, { ...fence(j), result, usage: u, pipeline_version: VERSION });
}

export function failJob(
  token: string,
  j: Claimed,
  errorClass: string,
  extra: { retry_after_s?: number | null; partial?: unknown; usage?: WorkerUsage | null } = {},
) {
  return wcall(token, `/jobs/${j.id}/fail`, {
    ...fence(j),
    error_class: errorClass,
    retry_after_s: extra.retry_after_s ?? null,
    message: `${errorClass} simulated`,
    usage: extra.usage ?? null,
    partial: extra.partial ?? null,
  });
}

/** Bấm bước 2 "Dịch" khi chương đã xong bước 1 (giống POST /translate-prepared); chưa xong → không làm gì. */
export async function translateIfPrepared(chapterId: string) {
  const [ch] = await db
    .select({ ws: chapters.workspaceId, status: chapters.status })
    .from(chapters)
    .where(eq(chapters.id, chapterId));
  if (ch?.status !== "prepared") return null;
  return inJobTx((tx) => translatePrepared(tx, ch.ws, chapterId));
}

/** Ingest giả: mỗi source = 1 page, upload PNG cho từng page qua presign-outputs. */
export async function doIngest(token: string, j: Claimed) {
  const sources = (j.inputs as { sources: { source_file_id: string }[] }).sources;
  const names = sources.map((_, i) => `page:${i}`);
  const res = await wcall(token, `/jobs/${j.id}/presign-outputs`, { ...fence(j), names });
  if (res.status !== 200) throw new Error(`presign ${res.status} ${await res.text()}`);
  const { outputs } = (await res.json()) as { outputs: Record<string, { put: string }> };
  await Promise.all(names.map((n) => putPng(outputs[n]?.put ?? "")));
  return complete(token, j, {
    type: "chapter.ingest",
    pages: sources.map((s, ord) => ({
      ord,
      width: 720,
      height: 3000,
      original_sha256: SHA,
      source_map: [{ source_file_id: s.source_file_id, src_y: 0, page_y: 0, h: 3000 }],
      cut_flag: false,
    })),
  });
}

/** OCR giả 1 vùng chữ trong bóng. */
export const OCR = {
  regions: [
    {
      id: "b0",
      kind: "bubble" as const,
      bbox: [10, 10, 200, 120] as [number, number, number, number],
      polarity: "dark_on_light" as const,
      bubble_id: null,
    },
    {
      id: "t0",
      kind: "text_bubble" as const,
      bbox: [40, 40, 120, 50] as [number, number, number, number],
      polarity: "dark_on_light" as const,
      bubble_id: "b0",
    },
  ],
  items: [{ id: "t0", source: "안녕하세요", is_sfx: false, empty: false, confidence: 0.9, low_conf: false }],
};

export async function doPrepare(token: string, j: Claimed, u: WorkerUsage | null = null) {
  await putPng(j.outputs.clean?.put ?? "");
  await putPng(j.outputs.mask?.put ?? "");
  const rev = j.outputs.clean?.rev ?? -1;
  return complete(token, j, { type: "page.prepare", clean_rev: rev, mask_rev: rev, ocr_result: OCR }, u);
}

export function aiState(w: number, h: number, text = "Xin chào"): PageState {
  return {
    ...emptyPageState(w, h),
    regions: [
      {
        id: "t0",
        kind: "text_bubble",
        bbox: [40, 40, 120, 50],
        polarity: "dark_on_light",
        source_text: "안녕하세요",
        translation: text,
        confidence: 0.9,
        flags: [],
      },
    ],
    meta: {
      pipeline_version: VERSION,
      model: "gemini-2.5-flash",
      glossary_rev: 0,
      settings_rev: 0,
      context_used: "rolling",
    },
  };
}

export async function doTranslate(token: string, j: Claimed, text = "Xin chào") {
  const ins = j.inputs as { pages: { page_id: string; width: number; height: number }[] };
  return complete(token, j, {
    type: "chapter.translate",
    pages: ins.pages.map((p) => ({ page_id: p.page_id, ai_state: aiState(p.width, p.height, text) })),
  });
}

/** Thêm n source file (key giả — ingest giả lập không đọc ảnh nguồn). */
export async function addSources(workspaceId: string, chapterId: string, n: number) {
  const sdb = scoped(db, workspaceId);
  for (let i = 0; i < n; i++) {
    await sdb.insert(sourceFiles, {
      chapterId,
      ord: i,
      storageKey: storageKeys.source(workspaceId, chapterId, uuidv7(), "png"),
      bytes: 100,
      mime: "image/png",
      width: 720,
      height: 3000,
    });
  }
}

export async function setWorkerMode(workspaceId: string, mode: "mac" | "modal") {
  await db
    .insert(workspaceSettings)
    .values({ workspaceId, workerMode: mode })
    .onConflictDoUpdate({ target: workspaceSettings.workspaceId, set: { workerMode: mode } });
}

/** Giả lập thời gian trôi: lease hết hạn ngay. */
export async function expireLease(jobId: string) {
  await db.update(jobs).set({ leaseExpiresAt: sql`now() - interval '1 second'` }).where(eq(jobs.id, jobId));
}

/** Cho job queued chạy được ngay (bỏ qua backoff). */
export async function makeRunnable(where = sql`true`) {
  await db
    .update(jobs)
    .set({ runAfter: sql`now() - interval '1 second'` })
    .where(sql`${jobs.status} = 'queued' and ${where}`);
}

export async function jobRow(id: string) {
  const [j] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!j) throw new Error(`job ${id} missing`);
  return j;
}

export async function pageRows(chapterId: string) {
  return db.select().from(pages).where(eq(pages.chapterId, chapterId)).orderBy(pages.ord);
}
