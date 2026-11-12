import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import { BBox, OcrRegion, OcrResult, PageState, Region } from "./page-state.ts";
import {
  InpaintOptions,
  isBaselinePrepareOptions,
  LOCAL_OCR_ENGINES,
  type OcrEngine,
  OcrEngineSchema,
  PROOFREAD_TIERS,
  PrepareOptions,
} from "./pipeline-settings.ts";
import { PAGE_FORMATS } from "./series-lang.ts";

export const JOB_TYPES = [
  "chapter.ingest",
  "page.prepare",
  "chapter.translate",
  "page.reinpaint",
  "page.ocr_region",
  "chapter.export",
  "chapter.proofread",
] as const;
export const JobType = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof JobType>;

/** Loại job gọi LLM — circuit breaker bỏ qua khi llm_paused. */
export const LLM_JOB_TYPES: readonly JobType[] = [
  "page.prepare",
  "chapter.translate",
  "page.ocr_region",
  "chapter.proofread",
];
/** Loại job tốn tiền — kill-switch ngân sách toàn cục chặn ở claim (hiện trùng LLM_JOB_TYPES). */
export const PAID_JOB_TYPES: readonly JobType[] = LLM_JOB_TYPES;
/** Vòng đời 1 lần gọi Modal /drain (bảng dispatches). */
export const DISPATCH_STATUSES = ["pending", "active", "ended", "no_claim"] as const;

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled", "paused_budget"] as const;
export const JobStatus = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatus>;
/** Trạng thái "đang hoạt động" — idempotency_key chỉ unique trong tập này (partial unique index). */
export const ACTIVE_JOB_STATUSES = ["queued", "running", "paused_budget"] as const satisfies readonly JobStatus[];

/**
 * provider = 5xx/timeout LLM; rate_limited = 429; schema = JSON LLM sai sau retry; invalid_input = ảnh hỏng/vượt trần;
 * auth = nhà cung cấp AI từ chối khoá API của worker (401/403) — sửa cấu hình rồi chạy lại.
 */
export const ERROR_CLASSES = ["provider", "rate_limited", "schema", "invalid_input", "auth", "internal"] as const;
export const ErrorClass = z.enum(ERROR_CLASSES);
/**
 * Người dùng vượt hạn mức chi phí ngày: mã lỗi 402 của API và tiền tố `jobs.error` của job LLM bị dừng
 * (error_class `internal`, không tính attempt).
 */
export const QUOTA_EXCEEDED = "quota_exceeded";
/** Tiền tố lỗi job khi tác vụ chưa có model AI (error_class `auth`). Worker giữ chuỗi trùng: `mtl_worker.LLM_NOT_CONFIGURED`. */
export const LLM_NOT_CONFIGURED = "llm_not_configured";
export type ErrorClass = z.infer<typeof ErrorClass>;

/** `prepared` = xong bước 1 (cắt trang + xoá chữ + OCR), chờ người dùng bấm "Dịch". */
export const CHAPTER_STATUSES = [
  "draft",
  "ingesting",
  "processing",
  "prepared",
  "review",
  "partial_failed",
  "done",
] as const;
export const PAGE_STATUSES = ["pending", "preparing", "prepared", "translating", "ready", "failed"] as const;
/** Lý do bỏ qua ảnh gốc trước Bước 1: người dùng xoá, hoặc khớp ảnh credit series đã học. Ảnh bỏ qua không vào ingest. */
export const SOURCE_SKIP_REASONS = ["user", "credit"] as const;
export type SourceSkipReason = (typeof SOURCE_SKIP_REASONS)[number];
/** Ai đặt số px cắt mép ảnh gốc: người dùng kéo tay, hoặc khớp dải credit series đã học. */
export const SOURCE_TRIM_SOURCES = ["user", "credit"] as const;
/** Sau khi cắt mép trên + dưới, ảnh gốc còn lại ít nhất bằng ngần này px. */
export const MIN_TRIM_KEEP_PX = 64;
/** Số px cắt ở mép trên/dưới ảnh gốc (đã lưu ở `source_files.trim`; 0/0 lưu thành null). */
export const SourceTrim = z.object({
  top: z.number().int().min(0),
  bottom: z.number().int().min(0),
  by: z.enum(SOURCE_TRIM_SOURCES),
});
export type SourceTrim = z.infer<typeof SourceTrim>;
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
export type ExportFormat = z.infer<typeof ExportFormat>;
/** original_slices = cắt lại đúng các slice upload gốc (theo pages.source_map); pages = 1 file / page. */
export const ExportLayout = z.enum(["original_slices", "pages"]);
export type ExportLayout = z.infer<typeof ExportLayout>;
/** Đuôi + MIME của file export (MIME nằm trong chữ ký presigned PUT). */
export const EXPORT_FILE = {
  png_zip: { ext: "zip", mime: "application/zip" },
  cbz: { ext: "cbz", mime: "application/vnd.comicbook+zip" },
} as const satisfies Record<ExportFormat, { ext: "zip" | "cbz"; mime: string }>;
/** File export bị xoá sau 7 ngày (lifecycle MinIO theo tag `EXPORT_OBJECT_TAG`); quá hạn → download 410. */
export const EXPORT_RETENTION_DAYS = 7;
export const EXPORT_OBJECT_TAG = "mtl-kind=export";

/** = series.page_format (xem series-lang.ts). */
export const IngestMode = z.enum(PAGE_FORMATS);

/**
 * Tham chiếu model do admin gán cho một tác vụ AI, chụp lúc enqueue (0.10.0). Không mang key: key giải mã lúc claim
 * và chỉ có trong response claim (`ClaimedJob.llm`). Slot chưa gán không có mặt → worker dùng cấu hình env.
 */
export const LlmRef = z.strictObject({ provider_id: Uuid, model: z.string().min(1).max(128) });
export type LlmRef = z.infer<typeof LlmRef>;
export const LlmRefs = z.object({ ocr: LlmRef.optional(), translate: LlmRef.optional(), proofread: LlmRef.optional() });
export type LlmRefs = z.infer<typeof LlmRefs>;

/** Snapshot cài đặt dịch lúc enqueue (job tái lập được dù series đổi sau đó). */
export const TranslateSettings = z.object({
  /** source_term → target_term (đã gộp entry chung + series). */
  glossary: z.record(z.string(), z.string()),
  /** Optional: job xếp hàng trước pipeline 0.4.0 không có → worker mặc định ko → vi. */
  source_lang: z.string().min(2).optional(),
  target_lang: z.string().min(2).optional(),
  pronoun_rules: z.string(),
  honorific_policy: z.string(),
  style_prompt: z.string(),
  /** font_id mặc định cho thoại. */
  font: z.string().min(1),
  /** font_id cho chữ ngoài bóng (text_free). Optional: job xếp hàng trước khi có trường này → worker dùng `font`. */
  narration_font: z.string().min(1).optional(),
  /**
   * font_id cho region `style: thought` / `note`. Chỉ có khi series đã chọn slot; thiếu (series chưa chọn, hoặc job
   * xếp hàng trước pipeline 0.8.0) → worker dùng font theo kind.
   */
  thought_font: z.string().min(1).optional(),
  note_font: z.string().min(1).optional(),
});
export type TranslateSettings = z.infer<typeof TranslateSettings>;

/**
 * Ngữ cảnh dịch chuyền giữa các job lô liên tiếp của một lượt (0.7.0): ghi chú của AI + tên nhân vật gặp gần nhất.
 * Result lô trước → payload lô sau; lô chưa có carry trong lượt nhận trí nhớ series (API); không có cả hai = ngữ cảnh rỗng như cũ.
 */
export const TranslateCarry = z.object({
  notes: z.string().max(2000),
  characters: z.array(z.string().min(1).max(64)).max(30),
});
export type TranslateCarry = z.infer<typeof TranslateCarry>;

export const TERM_KINDS = ["person", "place", "term"] as const;
export type TermKind = (typeof TERM_KINDS)[number];

/** Thuật ngữ/tên riêng AI gặp trong lô mà glossary của job chưa có — API lưu thành gợi ý chờ duyệt. */
export const LearnedTerm = z.object({
  source: z.string().min(1).max(200),
  target: z.string().min(1).max(200),
  kind: z.enum(TERM_KINDS),
});
export type LearnedTerm = z.infer<typeof LearnedTerm>;

/** Cặp xưng hô AI đã dùng mà pronoun_rules chưa có (giới hạn khớp PronounRule của series). */
export const LearnedPronoun = z.object({
  speaker: z.string().min(1).max(80),
  listener: z.string().min(1).max(80),
  address: z.string().min(1).max(120),
});
export type LearnedPronoun = z.infer<typeof LearnedPronoun>;

export const MAX_LEARNED_TERMS = 50;
export const MAX_LEARNED_PRONOUNS = 30;

/** carry cuối lượt dịch cả chương + cặp ngôn ngữ lúc dịch — trí nhớ series (chapters.translate_memory). */
export const TranslateMemory = TranslateCarry.extend({
  source_lang: z.string().min(2),
  target_lang: z.string().min(2),
});
export type TranslateMemory = z.infer<typeof TranslateMemory>;

export const JobPayload = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chapter.ingest"), chapter_id: Uuid, ingest_rev: Rev, mode: IngestMode }),
  z.object({
    type: z.literal("page.prepare"),
    page_id: Uuid,
    source_lang: z.string().min(2),
    /** Optional: job xếp hàng trước pipeline 0.4.0 không có → worker mặc định ltr. */
    reading_order: z.enum(["ltr", "rtl"]).optional(),
    /** Cài đặt pipeline của người dùng lúc enqueue (0.6.0). Thiếu → worker dùng mặc định cũ. */
    pipeline: PrepareOptions.optional(),
    /** Model slot OCR lúc enqueue (chỉ khi OCR engine là llm). Thiếu → worker dùng env. */
    llm: LlmRefs.optional(),
  }),
  z.object({
    type: z.literal("chapter.translate"),
    chapter_id: Uuid,
    page_ids: z.array(Uuid).min(1),
    context: z.enum(["rolling", "neighbors"]),
    glossary_rev: Rev,
    settings_rev: Rev,
    settings: TranslateSettings,
    carry: TranslateCarry.optional(),
    /** Model slot Dịch lúc enqueue. Thiếu → worker dùng env. */
    llm: LlmRefs.optional(),
  }),
  z
    .object({
      type: z.literal("page.reinpaint"),
      page_id: Uuid,
      base_clean_rev: Rev,
      /** Mask người vẽ (Mask B): có cả key + offset. */
      user_mask_key: z.string().min(1).optional(),
      offset: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
      /**
       * OCR vùng tự xoá chữ gốc (0.9.0): worker tự dựng mask nét chữ trong khung này (toạ độ page) trên ảnh sạch
       * hiện tại. Loại trừ với `user_mask_key`/`offset`.
       */
      auto_text_bbox: BBox.optional(),
      /** Inpainter của người dùng lúc enqueue (0.6.0). Thiếu → big_lama 512. */
      inpaint: InpaintOptions.optional(),
    })
    .refine((p) => (p.auto_text_bbox ? !p.user_mask_key && !p.offset : !!p.user_mask_key && !!p.offset), {
      message: "page.reinpaint cần đúng một nguồn mask: user_mask_key + offset, hoặc auto_text_bbox",
    }),
  z.object({
    type: z.literal("page.ocr_region"),
    page_id: Uuid,
    bbox: BBox,
    /** Optional: job xếp hàng trước pipeline 0.4.0 không có → worker mặc định ko → vi. */
    source_lang: z.string().min(2).optional(),
    target_lang: z.string().min(2).optional(),
    /** OCR engine theo cài đặt người dùng (0.6.0). Thiếu → llm. Dịch vẫn qua LLM. */
    ocr_engine: OcrEngineSchema.optional(),
    /** Thứ tự đọc của chương (0.6.0): `rtl` → OCR local đọc khối chữ cao theo cột dọc. Thiếu → ltr. */
    reading_order: z.enum(["ltr", "rtl"]).optional(),
    /** Model slot OCR (engine llm) + Dịch lúc enqueue. Thiếu → worker dùng env. */
    llm: LlmRefs.optional(),
  }),
  z.object({
    type: z.literal("chapter.export"),
    chapter_id: Uuid,
    format: ExportFormat,
    layout: ExportLayout,
    quality: z.number().int().min(1).max(100),
    include_untranslated: z.boolean(),
  }),
  z.object({
    /** AI hiệu đính: đề xuất sửa bản dịch theo khối (không ghi page_state; gợi ý lưu ở proofread_suggestions). */
    type: z.literal("chapter.proofread"),
    chapter_id: Uuid,
    page_ids: z.array(Uuid).min(1),
    /** Chỉ có khi chưa gán slot Hiệu đính (job cũ/mới dùng chung khoá `{tier}`); bỏ ở bản sau 0.10.0. */
    model_tier: z.enum(PROOFREAD_TIERS).optional(),
    /** Model slot Hiệu đính lúc enqueue; có thì không có `model_tier`. */
    llm: LlmRefs.optional(),
    settings: TranslateSettings,
  }),
]);
export type JobPayload = z.infer<typeof JobPayload>;

/**
 * Job có gọi LLM (breaker + kill-switch ngân sách áp vào). `page.prepare` OCR local không gọi LLM (usage 0) — SQL
 * tương ứng ở apps/api `llmJobSql`.
 */
export function isLlmPayload(p: Pick<JobPayload, "type"> & { pipeline?: { ocr_engine?: string } }): boolean {
  if (!LLM_JOB_TYPES.includes(p.type)) return false;
  return !(p.type === "page.prepare" && LOCAL_OCR_ENGINES.includes(p.pipeline?.ocr_engine as OcrEngine));
}

/** source_map: slice gốc nào phủ đoạn y nào của page (để xuất lại theo slice). */
export const SourceMapEntry = z.object({
  source_file_id: Uuid,
  src_y: z.number().int().nonnegative(),
  page_y: z.number().int().nonnegative(),
  h: z.number().int().positive(),
});

/** 1 gợi ý hiệu đính: `old` = bản dịch worker đã thấy lúc claim (để phát hiện gợi ý lỗi thời). */
export const ProofreadSuggestionOut = z.object({
  page_id: Uuid,
  region_id: z.string().min(1).max(64),
  old: z.string().max(4000),
  suggestion: z.string().min(1).max(4000),
  reason: z.string().max(500),
});
export type ProofreadSuggestionOut = z.infer<typeof ProofreadSuggestionOut>;

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
    carry: TranslateCarry.optional(),
    new_terms: z.array(LearnedTerm).max(MAX_LEARNED_TERMS).optional(),
    pronoun_pairs: z.array(LearnedPronoun).max(MAX_LEARNED_PRONOUNS).optional(),
  }),
  z.object({ type: z.literal("page.reinpaint"), clean_rev: Rev }),
  z.object({ type: z.literal("page.ocr_region"), region: Region }),
  z.object({ type: z.literal("chapter.export"), key: z.string().min(1), bytes: z.number().int().nonnegative() }),
  z.object({ type: z.literal("chapter.proofread"), suggestions: z.array(ProofreadSuggestionOut).max(2000) }),
]);
export type JobResult = z.infer<typeof JobResult>;

/** Artifact giai đoạn 1 trước LLM, gửi kèm `fail` khi lỗi provider → lần chạy sau bỏ qua detect/inpaint. */
export const PreparePartial = z.object({ clean_rev: Rev, mask_rev: Rev, regions: z.array(OcrRegion) });
export type PreparePartial = z.infer<typeof PreparePartial>;

const hex = (s: string) => bytesToHex(sha256(utf8ToBytes(s)));

/**
 * input_rev của page.prepare = sha256(original_sha256 | settings_rev | pipeline_version [| tuỳ chọn pipeline]).
 * Tuỳ chọn pipeline chỉ trộn vào khi khác mặc định → page/job tạo trước khi có cài đặt giữ nguyên input_rev.
 */
export function prepareInputRev(
  originalSha256: string,
  settingsRev: number,
  pipelineVersion: string,
  options?: PrepareOptions,
): string {
  const parts: unknown[] = [originalSha256, settingsRev, pipelineVersion];
  if (options && !isBaselinePrepareOptions(options)) parts.push(stableStringify(options));
  return hex(parts.join("|"));
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
