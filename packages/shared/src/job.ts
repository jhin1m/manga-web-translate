import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import { BBox, OcrRegion, OcrResult, PageState, Region } from "./page-state.ts";

export const JOB_TYPES = [
  "chapter.ingest",
  "page.prepare",
  "chapter.translate",
  "page.reinpaint",
  "page.ocr_region",
  "chapter.export",
] as const;
export const JobType = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof JobType>;

/** Loại job gọi LLM — circuit breaker bỏ qua khi llm_paused. */
export const LLM_JOB_TYPES: readonly JobType[] = ["page.prepare", "chapter.translate", "page.ocr_region"];

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled", "paused_budget"] as const;
export const JobStatus = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatus>;
/** Trạng thái "đang hoạt động" — idempotency_key chỉ unique trong tập này (partial unique index). */
export const ACTIVE_JOB_STATUSES = ["queued", "running", "paused_budget"] as const satisfies readonly JobStatus[];

/** provider = 5xx/timeout LLM; rate_limited = 429; schema = JSON LLM sai sau retry; invalid_input = ảnh hỏng/vượt trần. */
export const ERROR_CLASSES = ["provider", "rate_limited", "schema", "invalid_input", "internal"] as const;
export const ErrorClass = z.enum(ERROR_CLASSES);
export type ErrorClass = z.infer<typeof ErrorClass>;

export const CHAPTER_STATUSES = ["draft", "ingesting", "processing", "review", "partial_failed", "done"] as const;
export const PAGE_STATUSES = ["pending", "preparing", "prepared", "translating", "ready", "failed"] as const;
export const USAGE_KINDS = [
  "pages",
  "llm_tokens_in",
  "llm_tokens_out",
  "gpu_seconds",
  "gpu_idle_seconds",
  "storage_bytes",
] as const;

const Uuid = z.uuid();
const Rev = z.number().int().nonnegative();

export const ExportFormat = z.enum(["png_zip", "cbz"]);
export const ExportLayout = z.enum(["original_slices", "pages"]);

/** strip = ghép slice cùng width thành strip ảo rồi cắt theo detector (manhwa); pages = 1 file = 1 page (manga). */
export const IngestMode = z.enum(["strip", "pages"]);

/** Snapshot cài đặt dịch lúc enqueue (job tái lập được dù series đổi sau đó). */
export const TranslateSettings = z.object({
  /** source_term → target_term (đã gộp entry workspace + series). */
  glossary: z.record(z.string(), z.string()),
  pronoun_rules: z.string(),
  honorific_policy: z.string(),
  style_prompt: z.string(),
  /** font_id mặc định cho thoại. */
  font: z.string().min(1),
});
export type TranslateSettings = z.infer<typeof TranslateSettings>;

export const JobPayload = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chapter.ingest"), chapter_id: Uuid, ingest_rev: Rev, mode: IngestMode }),
  z.object({ type: z.literal("page.prepare"), page_id: Uuid, source_lang: z.string().min(2) }),
  z.object({
    type: z.literal("chapter.translate"),
    chapter_id: Uuid,
    page_ids: z.array(Uuid).min(1),
    context: z.enum(["rolling", "neighbors"]),
    glossary_rev: Rev,
    settings_rev: Rev,
    settings: TranslateSettings,
  }),
  z.object({
    type: z.literal("page.reinpaint"),
    page_id: Uuid,
    base_clean_rev: Rev,
    user_mask_key: z.string().min(1),
    offset: z.object({ x: z.number().int(), y: z.number().int() }),
  }),
  z.object({ type: z.literal("page.ocr_region"), page_id: Uuid, bbox: BBox }),
  z.object({
    type: z.literal("chapter.export"),
    chapter_id: Uuid,
    format: ExportFormat,
    layout: ExportLayout,
    quality: z.number().int().min(1).max(100),
    include_untranslated: z.boolean(),
  }),
]);
export type JobPayload = z.infer<typeof JobPayload>;

/** source_map: slice gốc nào phủ đoạn y nào của page (để xuất lại theo slice). */
export const SourceMapEntry = z.object({
  source_file_id: Uuid,
  src_y: z.number().int().nonnegative(),
  page_y: z.number().int().nonnegative(),
  h: z.number().int().positive(),
});

export const JobResult = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("chapter.ingest"),
    pages: z.array(
      z.object({
        ord: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        original_sha256: z.string().regex(/^[0-9a-f]{64}$/),
        source_map: z.array(SourceMapEntry),
        cut_flag: z.boolean(),
      }),
    ),
  }),
  z.object({ type: z.literal("page.prepare"), clean_rev: Rev, mask_rev: Rev, ocr_result: OcrResult }),
  z.object({
    type: z.literal("chapter.translate"),
    pages: z.array(z.object({ page_id: Uuid, ai_state: PageState })),
  }),
  z.object({ type: z.literal("page.reinpaint"), clean_rev: Rev }),
  z.object({ type: z.literal("page.ocr_region"), region: Region }),
  z.object({ type: z.literal("chapter.export"), key: z.string().min(1), bytes: z.number().int().nonnegative() }),
]);
export type JobResult = z.infer<typeof JobResult>;

/** Artifact giai đoạn 1 trước LLM, gửi kèm `fail` khi lỗi provider → lần chạy sau bỏ qua detect/inpaint. */
export const PreparePartial = z.object({ clean_rev: Rev, mask_rev: Rev, regions: z.array(OcrRegion) });
export type PreparePartial = z.infer<typeof PreparePartial>;

const hex = (s: string) => bytesToHex(sha256(utf8ToBytes(s)));

/** input_rev của page.prepare = sha256(original_sha256 | settings_rev | pipeline_version). */
export function prepareInputRev(originalSha256: string, settingsRev: number, pipelineVersion: string): string {
  return hex([originalSha256, settingsRev, pipelineVersion].join("|"));
}

/**
 * input_rev của chapter.translate = sha256(sorted(page_id:prepare_input_rev) | glossary_rev | settings_rev | pipeline_version).
 * Thứ tự page đầu vào không ảnh hưởng kết quả.
 */
export function translateInputRev(
  pages: ReadonlyArray<{ pageId: string; prepareInputRev: string }>,
  glossaryRev: number,
  settingsRev: number,
  pipelineVersion: string,
): string {
  const items = pages.map((p) => `${p.pageId}:${p.prepareInputRev}`).sort();
  return hex([items.join(","), glossaryRev, settingsRev, pipelineVersion].join("|"));
}

/** Serialize ổn định (key sắp xếp) để options cùng nội dung → cùng key. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** idempotency_key = sha256(type | target_id | input_rev | options). */
export function idempotencyKey(type: JobType, targetId: string, inputRev: string, options: unknown = {}): string {
  return hex([type, targetId, inputRev, stableStringify(options)].join("|"));
}

/**
 * Page id tất định = uuid v5(namespace = chapter_id, name = "{ingest_rev}:{ord}").
 * Python: uuid.uuid5(uuid.UUID(chapter_id), f"{ingest_rev}:{ord}").
 */
export function pageId(chapterId: string, ingestRev: number, ord: number): string {
  return uuidv5(`${ingestRev}:${ord}`, chapterId);
}
