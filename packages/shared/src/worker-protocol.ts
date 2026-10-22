/**
 * Hợp đồng HTTP giữa API và worker (`/worker/v1/*`). Worker Python validate bằng JSON Schema sinh từ đây.
 * Mọi lệnh sau claim mang `{lease_token, attempt}` (fencing): sai/hết lease → 409, worker bỏ job.
 */
import { z } from "zod";
import { ErrorClass, JobPayload, JobResult, JobType, PreparePartial, SourceMapEntry } from "./job.ts";
import { OcrRegion, OcrResult, PageState } from "./page-state.ts";

const Uuid = z.uuid();
const Rev = z.number().int().nonnegative();
const Url = z.url();
/** major.minor.patch — so sánh với MIN_PIPELINE_VERSION ở claim. */
export const PipelineVersion = z.string().regex(/^\d+\.\d+\.\d+$/);

/** Số đếm thô; server clamp + nhân bảng giá. `seq` tăng dần trong 1 attempt → gửi lại cùng seq không đếm đôi. */
export const WorkerUsage = z.object({
  seq: z.number().int().positive(),
  model: z.string().min(1).nullable(),
  llm_in: z.number().int().nonnegative(),
  llm_out: z.number().int().nonnegative(),
  calls: z.number().int().nonnegative(),
  gpu_s: z.number().nonnegative(),
});
export type WorkerUsage = z.infer<typeof WorkerUsage>;

export const ClaimRequest = z.object({
  worker_id: z.string().min(1).max(64),
  capabilities: z.array(JobType).min(1),
  max: z.number().int().min(1).max(8),
  pipeline_version: PipelineVersion,
  dispatch_id: Uuid.nullable(),
});

const Fence = { lease_token: z.string().min(16), attempt: z.number().int().positive() };

export const HeartbeatRequest = z.object({
  ...Fence,
  progress: z.number().min(0).max(1),
  stage: z.string().max(64).nullable(),
  usage: WorkerUsage.nullable(),
});
export const HeartbeatResponse = z.object({
  lease_expires_at: z.string(),
  stop: z.enum(["cancel", "paused_budget"]).nullable(),
});

/**
 * Tên output: `clean`, `mask` (rev cấp lúc claim), `page:<ord>` (ảnh page của chapter.ingest) hoặc `export`
 * (file ZIP/CBZ của chapter.export).
 */
export const OutputName = z.string().regex(/^(clean|mask|page:\d{1,4}|export)$/);
export const PresignOutputsRequest = z.object({ ...Fence, names: z.array(OutputName).min(1).max(512) });
export const PresignedOutput = z.object({
  key: z.string(),
  rev: Rev.nullable(),
  put: Url,
  expires_at: z.string(),
  /** Header nằm trong chữ ký PUT — worker phải gửi đúng (thiếu = `content-type: image/png`). */
  headers: z.record(z.string(), z.string()).optional(),
});
export const PresignOutputsResponse = z.object({ outputs: z.record(z.string(), PresignedOutput) });

export const CompleteRequest = z.object({
  ...Fence,
  result: JobResult,
  usage: WorkerUsage.nullable(),
  pipeline_version: PipelineVersion,
});

export const FailRequest = z.object({
  ...Fence,
  error_class: ErrorClass,
  retry_after_s: z.number().nonnegative().nullable(),
  message: z.string().max(4000),
  usage: WorkerUsage.nullable(),
  partial: PreparePartial.nullable(),
});

/** Container Modal báo lúc thoát (chỉ token nền tảng) → ledger `gpu_idle_seconds = lifetime − busy`. */
export const SessionsEndRequest = z.object({
  dispatch_id: Uuid,
  lifetime_s: z.number().nonnegative().max(86_400),
  busy_s: z.number().nonnegative().max(86_400),
});

/** Dòng ngữ cảnh lân cận (bản dịch rỗng = trang sau, chưa dịch). */
export const ContextLine = z.object({ source: z.string(), translation: z.string() });

export const IngestInputs = z.object({
  sources: z.array(
    z.object({
      source_file_id: Uuid,
      url: Url,
      width: z.number().int().positive().nullable(),
      height: z.number().int().positive().nullable(),
    }),
  ),
});
export const PrepareInputs = z.object({
  original: Url,
  /** Artifact trước LLM của attempt trước (cùng prepare_input_rev) → bỏ qua detect/inpaint. */
  partial: z.object({ clean: Url, mask: Url, regions: z.array(OcrRegion) }).nullable(),
});
export const TranslateInputs = z.object({
  pages: z.array(
    z.object({
      page_id: Uuid,
      ord: z.number().int().nonnegative(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      ocr_result: OcrResult,
      clean: Url,
    }),
  ),
  /** context=neighbors: nguồn + bản dịch trang n−1, nguồn trang n+1. */
  context_lines: z.array(ContextLine),
});
export const ReinpaintInputs = z.object({ base_clean: Url, user_mask: Url });
export const OcrRegionInputs = z.object({ original: Url, context_lines: z.array(ContextLine) });
/**
 * chapter.export: state chốt lúc claim (đổi sau đó không ảnh hưởng file đang xuất). `translated` = page đã qua
 * giai đoạn 2 và có ảnh sạch → nền = clean/{clean_rev}; ngược lại nền = ảnh gốc, không vẽ chữ. `skipped` = người
 * dùng đã xoá (ẩn) page: layout `pages` bỏ page, `original_slices` bỏ slice nằm trọn trong page ẩn, slice vắt qua giữ
 * phần đó bằng ảnh gốc (optional: inputs dựng lúc claim; API bản cũ (rollback) không gửi → coi như false).
 */
export const ExportInputs = z.object({
  chapter: z.object({ series_title: z.string(), number: z.string(), title: z.string() }),
  pages: z.array(
    z.object({
      page_id: Uuid,
      ord: z.number().int().nonnegative(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      translated: z.boolean(),
      skipped: z.boolean().optional(),
      background: Url,
      state: PageState.nullable(),
      source_map: z.array(SourceMapEntry),
    }),
  ),
  /** Slice gốc theo thứ tự upload — tên file khi xuất layout `original_slices`. */
  sources: z.array(z.object({ source_file_id: Uuid, ord: z.number().int().nonnegative() })),
});

export const ClaimedJob = z.object({
  id: Uuid,
  type: JobType,
  attempt: z.number().int().positive(),
  lease_token: z.string(),
  lease_expires_at: z.string(),
  payload: JobPayload,
  inputs: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), PresignedOutput),
});
export type ClaimedJob = z.infer<typeof ClaimedJob>;
export const ClaimResponse = z.object({ jobs: z.array(ClaimedJob) });
