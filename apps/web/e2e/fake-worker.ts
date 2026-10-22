/**
 * Worker giả lập CHỈ cho e2e: gọi đúng giao thức /worker/v1 (claim → presign-outputs/PUT → complete với
 * lease_token + attempt) nhưng không chạy AI — mỗi slice = `pagesPerSource` page (mặc định 1) cao 1000px,
 * OCR/dịch cố định. Server chỉ kiểm `source_file_id` của source_map, nên 1 slice cắt k page được.
 */
import { zipSync } from "fflate";
import { emptyPageState, type PageState } from "../../../packages/shared/src/index.ts";
import { API_URL } from "./env.ts";

const VERSION = "0.4.1";
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
  outputs: Record<string, { key: string; put: string; rev: number | null; headers?: Record<string, string> }>;
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

/** PUT đúng header đã ký (content-type, x-amz-tagging…) — file export có MIME/tag theo format. */
async function putWith(out: { put: string; headers?: Record<string, string> }, body: Uint8Array<ArrayBuffer>) {
  const res = await fetch(out.put, { method: "PUT", body, headers: out.headers });
  if (!res.ok) throw new Error(`PUT ${res.status} ${await res.text()}`);
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

export type FakeWorkerOptions = {
  /** Số page cắt từ mỗi slice nguồn (page cao 1000, `src_y = i·1000`). */
  pagesPerSource?: number;
  /** Loại job nhận (mặc định tất cả) — VD chỉ ingest + prepare để giữ chương ở "processing". */
  capabilities?: string[];
};

const ALL_CAPABILITIES = ["chapter.ingest", "page.prepare", "chapter.translate", "chapter.export"];

async function handle(token: string, j: Claimed, opts: FakeWorkerOptions) {
  if (j.type === "chapter.ingest") {
    const k = opts.pagesPerSource ?? 1;
    const sources = (j.inputs as { sources: { source_file_id: string }[] }).sources;
    const cuts = sources.flatMap((s) => Array.from({ length: k }, (_, i) => ({ id: s.source_file_id, i })));
    const names = cuts.map((_, i) => `page:${i}`);
    const { outputs } = await call<{ outputs: Record<string, { put: string }> }>(
      token,
      `/jobs/${j.id}/presign-outputs`,
      { ...fence(j), names },
    );
    await Promise.all(names.map((n) => put(outputs[n]?.put ?? "")));
    return complete(token, j, {
      type: "chapter.ingest",
      pages: cuts.map((c, ord) => ({
        ord,
        width: 720,
        height: 1000,
        original_sha256: SHA,
        source_map: [{ source_file_id: c.id, src_y: c.i * 1000, page_y: 0, h: 1000 }],
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
  if (j.type === "chapter.export") {
    // Nội dung giả (zip 1 ảnh) — server chỉ kiểm key và đo bytes từ object thật.
    const out = j.outputs.export;
    if (!out) throw new Error("fake worker: export output missing");
    const body = new Uint8Array(zipSync({ "1.png": new Uint8Array(PNG_1PX) }));
    await putWith(out, body);
    return complete(token, j, { type: "chapter.export", key: out.key, bytes: body.byteLength });
  }
  throw new Error(`fake worker: unsupported ${j.type}`);
}

/** Vòng lặp claim tới khi `until()` đúng hoặc hết giờ. */
export async function runFakeWorker(
  token: string,
  until: () => boolean,
  timeoutMs = 30_000,
  opts: FakeWorkerOptions = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (!until() && Date.now() < deadline) {
    const { jobs } = await call<{ jobs: Claimed[] }>(token, "/claim", {
      worker_id: "e2e-fake",
      capabilities: opts.capabilities ?? ALL_CAPABILITIES,
      max: 8,
      pipeline_version: VERSION,
      dispatch_id: null,
    });
    if (jobs.length === 0) await new Promise((r) => setTimeout(r, 300));
    await Promise.all(jobs.map((j) => handle(token, j, opts)));
  }
}
