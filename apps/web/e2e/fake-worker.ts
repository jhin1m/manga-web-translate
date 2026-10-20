/**
 * Worker giả lập CHỈ cho e2e: gọi đúng giao thức /worker/v1 (claim → presign-outputs/PUT → complete với
 * lease_token + attempt) nhưng không chạy AI — mỗi slice = 1 page, OCR/dịch cố định.
 */
import { emptyPageState, type PageState } from "../../../packages/shared/src/index.ts";
import { API_URL } from "./env.ts";

const VERSION = "0.3.0";
const SHA = "ab".repeat(32);
/** PNG 1×1 hợp lệ. */
export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type Claimed = {
  id: string;
  type: string;
  attempt: number;
  lease_token: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, { put: string; rev: number | null }>;
};

async function call<T>(token: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/worker/v1${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function put(url: string) {
  const res = await fetch(url, { method: "PUT", body: PNG_1PX, headers: { "content-type": "image/png" } });
  if (!res.ok) throw new Error(`PUT ${res.status}`);
}

const fence = (j: Claimed) => ({ lease_token: j.lease_token, attempt: j.attempt });
const complete = (token: string, j: Claimed, result: unknown) =>
  call(token, `/jobs/${j.id}/complete`, { ...fence(j), result, usage: null, pipeline_version: VERSION });

const OCR = {
  regions: [{ id: "t0", kind: "text_bubble", bbox: [40, 40, 120, 50], polarity: "dark_on_light", bubble_id: null }],
  items: [{ id: "t0", source: "안녕하세요", is_sfx: false, empty: false, confidence: 0.9, low_conf: false }],
};

function aiState(w: number, h: number): PageState {
  return {
    ...emptyPageState(w, h),
    regions: [
      {
        id: "t0",
        kind: "text_bubble",
        bbox: [40, 40, 120, 50],
        polarity: "dark_on_light",
        source_text: "안녕하세요",
        translation: "Xin chào",
        confidence: 0.9,
        flags: [],
      },
    ],
    meta: { pipeline_version: VERSION, model: "fake", glossary_rev: 0, settings_rev: 0, context_used: "rolling" },
  };
}

async function handle(token: string, j: Claimed) {
  if (j.type === "chapter.ingest") {
    const sources = (j.inputs as { sources: { source_file_id: string }[] }).sources;
    const names = sources.map((_, i) => `page:${i}`);
    const { outputs } = await call<{ outputs: Record<string, { put: string }> }>(
      token,
      `/jobs/${j.id}/presign-outputs`,
      { ...fence(j), names },
    );
    await Promise.all(names.map((n) => put(outputs[n]?.put ?? "")));
    return complete(token, j, {
      type: "chapter.ingest",
      pages: sources.map((s, ord) => ({
        ord,
        width: 720,
        height: 1000,
        original_sha256: SHA,
        source_map: [{ source_file_id: s.source_file_id, src_y: 0, page_y: 0, h: 1000 }],
        cut_flag: false,
      })),
    });
  }
  if (j.type === "page.prepare") {
    await put(j.outputs.clean?.put ?? "");
    await put(j.outputs.mask?.put ?? "");
    const rev = j.outputs.clean?.rev ?? -1;
    return complete(token, j, { type: "page.prepare", clean_rev: rev, mask_rev: rev, ocr_result: OCR });
  }
  if (j.type === "chapter.translate") {
    const pages = (j.inputs as { pages: { page_id: string; width: number; height: number }[] }).pages;
    return complete(token, j, {
      type: "chapter.translate",
      pages: pages.map((p) => ({ page_id: p.page_id, ai_state: aiState(p.width, p.height) })),
    });
  }
  throw new Error(`fake worker: unsupported ${j.type}`);
}

/** Vòng lặp claim tới khi `until()` đúng hoặc hết giờ. */
export async function runFakeWorker(token: string, until: () => boolean, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (!until() && Date.now() < deadline) {
    const { jobs } = await call<{ jobs: Claimed[] }>(token, "/claim", {
      worker_id: "e2e-fake",
      capabilities: ["chapter.ingest", "page.prepare", "chapter.translate"],
      max: 8,
      pipeline_version: VERSION,
      dispatch_id: null,
    });
    if (jobs.length === 0) await new Promise((r) => setTimeout(r, 300));
    await Promise.all(jobs.map((j) => handle(token, j)));
  }
}
