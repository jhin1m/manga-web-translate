/**
 * Cài đặt pipeline của người dùng (Cài đặt chung → Pipeline). Worker không đọc DB: API snapshot phần cần thiết vào
 * payload job lúc enqueue (`page.prepare.pipeline`, `page.reinpaint.inpaint`, `page.ocr_region.ocr_engine`).
 * Mặc định = hành vi trước khi có cài đặt → người dùng chưa cấu hình chạy y hệt.
 */
import { z } from "zod";
import { SOURCE_LANGS, type SourceLang } from "./series-lang.ts";

/** rtdetr_v2_comic = bóng + chữ (mặc định); comic_text_detector = khối chữ CTD, bóng vẫn lấy từ RT-DETR. */
export const TEXT_DETECTORS = ["rtdetr_v2_comic", "comic_text_detector"] as const;
/** llm = OCR bằng LLM vision (mặc định, tính tiền); manga_ocr / paddle_ocr chạy local (ONNX, không token). */
export const OCR_ENGINES = ["llm", "manga_ocr", "paddle_ocr"] as const;
/** big_lama = LaMa tổng quát (mặc định); lama_manga = LaMa huấn luyện cho manga/anime. */
export const INPAINTERS = ["big_lama", "lama_manga"] as const;
export const PROOFREAD_TIERS = ["standard", "premium"] as const;

export type TextDetector = (typeof TEXT_DETECTORS)[number];
export type OcrEngine = (typeof OCR_ENGINES)[number];
export type Inpainter = (typeof INPAINTERS)[number];
export type ProofreadTier = (typeof PROOFREAD_TIERS)[number];

/** Ngôn ngữ nguồn mỗi engine đọc được (manga-ocr chỉ tiếng Nhật). */
export const OCR_ENGINE_LANGS: Record<OcrEngine, readonly SourceLang[]> = {
  llm: SOURCE_LANGS,
  manga_ocr: ["ja"],
  paddle_ocr: ["ko", "zh", "ja", "en"],
};
/** OCR chạy local trên worker — không gọi LLM, không tính token. */
export const LOCAL_OCR_ENGINES: readonly OcrEngine[] = ["manga_ocr", "paddle_ocr"];

export const ocrEngineSupports = (engine: OcrEngine, lang: string): boolean =>
  (OCR_ENGINE_LANGS[engine] as readonly string[]).includes(lang);

export const DETECTION_THRESHOLD = { min: 0.05, max: 0.95, default: 0.35 } as const;
/** null = tự động (2–6px theo cạnh ngắn của box, như trước). */
export const MASK_DILATION = { min: 0, max: 24 } as const;
/** Cạnh tối đa vùng gom vào 1 lượt model xoá chữ (model nhận 512×512; vùng lớn hơn bị thu nhỏ). */
export const INPAINT_SIZE = { min: 256, max: 1024, default: 512 } as const;

export const OcrEngineSchema = z.enum(OCR_ENGINES);

const PipelineSettingsFields = z.object({
  detector: z.enum(TEXT_DETECTORS),
  detection_threshold: z.number().min(DETECTION_THRESHOLD.min).max(DETECTION_THRESHOLD.max),
  /** OCR engine theo ngôn ngữ nguồn của series. */
  ocr_engines: z.object({ ko: OcrEngineSchema, ja: OcrEngineSchema, zh: OcrEngineSchema, en: OcrEngineSchema }),
  inpainter: z.enum(INPAINTERS),
  mask_dilation: z.number().int().min(MASK_DILATION.min).max(MASK_DILATION.max).nullable(),
  inpaint_size: z.number().int().min(INPAINT_SIZE.min).max(INPAINT_SIZE.max),
  proofread_tier: z.enum(PROOFREAD_TIERS),
});

export const PipelineSettings = PipelineSettingsFields.superRefine((s, ctx) => {
  for (const lang of SOURCE_LANGS) {
    if (!ocrEngineSupports(s.ocr_engines[lang], lang)) {
      ctx.addIssue({
        code: "custom",
        path: ["ocr_engines", lang],
        message: `${s.ocr_engines[lang]} không đọc được ngôn ngữ ${lang}`,
      });
    }
  }
});
export type PipelineSettings = z.infer<typeof PipelineSettings>;

export const DEFAULT_PIPELINE_SETTINGS: PipelineSettings = {
  detector: "rtdetr_v2_comic",
  detection_threshold: DETECTION_THRESHOLD.default,
  ocr_engines: { ko: "llm", ja: "llm", zh: "llm", en: "llm" },
  inpainter: "big_lama",
  mask_dilation: null,
  inpaint_size: INPAINT_SIZE.default,
  proofread_tier: "standard",
};

/**
 * Đọc cài đặt đã lưu (jsonb, có thể thiếu key / key cũ không còn hợp lệ): bắt đầu từ mặc định, nhận từng key hợp lệ
 * (engine không hợp ngôn ngữ → giữ mặc định của ngôn ngữ đó). Không bao giờ ném lỗi.
 */
export function resolvePipelineSettings(stored: unknown): PipelineSettings {
  const out: PipelineSettings = structuredClone(DEFAULT_PIPELINE_SETTINGS);
  if (!stored || typeof stored !== "object") return out;
  const raw = stored as Record<string, unknown>;
  const shape: Record<string, z.ZodType> = PipelineSettingsFields.shape;
  for (const key of Object.keys(out) as (keyof PipelineSettings)[]) {
    if (key === "ocr_engines") continue;
    const parsed = shape[key]?.safeParse(raw[key]);
    if (parsed?.success) (out as Record<string, unknown>)[key] = parsed.data;
  }
  const engines = raw.ocr_engines as Record<string, unknown> | undefined;
  for (const lang of SOURCE_LANGS) {
    const e = OcrEngineSchema.safeParse(engines?.[lang]);
    if (e.success && ocrEngineSupports(e.data, lang)) out.ocr_engines[lang] = e.data;
  }
  return out;
}

/** Snapshot giai đoạn 1 trong payload `page.prepare` (OCR engine đã chọn theo ngôn ngữ nguồn của series). */
export const PrepareOptions = z.object({
  detector: z.enum(TEXT_DETECTORS),
  detection_threshold: z.number().min(DETECTION_THRESHOLD.min).max(DETECTION_THRESHOLD.max),
  ocr_engine: OcrEngineSchema,
  inpainter: z.enum(INPAINTERS),
  mask_dilation: z.number().int().min(MASK_DILATION.min).max(MASK_DILATION.max).nullable(),
  inpaint_size: z.number().int().min(INPAINT_SIZE.min).max(INPAINT_SIZE.max),
});
export type PrepareOptions = z.infer<typeof PrepareOptions>;

/** Snapshot xoá chữ lại (`page.reinpaint.inpaint`) — mask người vẽ không giãn thêm. */
export const InpaintOptions = z.object({
  inpainter: z.enum(INPAINTERS),
  inpaint_size: z.number().int().min(INPAINT_SIZE.min).max(INPAINT_SIZE.max),
});
export type InpaintOptions = z.infer<typeof InpaintOptions>;

/** Engine cho ngôn ngữ nguồn; ngôn ngữ lạ hoặc engine không hợp → LLM (luôn đọc được). */
export function ocrEngineFor(s: PipelineSettings, sourceLang: string): OcrEngine {
  const e = s.ocr_engines[sourceLang as SourceLang];
  return e && ocrEngineSupports(e, sourceLang) ? e : "llm";
}

export function prepareOptions(s: PipelineSettings, sourceLang: string): PrepareOptions {
  return {
    detector: s.detector,
    detection_threshold: s.detection_threshold,
    ocr_engine: ocrEngineFor(s, sourceLang),
    inpainter: s.inpainter,
    mask_dilation: s.mask_dilation,
    inpaint_size: s.inpaint_size,
  };
}

export const inpaintOptions = (s: PipelineSettings): InpaintOptions => ({
  inpainter: s.inpainter,
  inpaint_size: s.inpaint_size,
});

/** Tuỳ chọn giai đoạn 1 có khác hành vi mặc định không (khác → trộn vào input_rev của page.prepare). */
export function isDefaultPrepareOptions(o: PrepareOptions): boolean {
  const d = prepareOptions(DEFAULT_PIPELINE_SETTINGS, "ko");
  return (Object.keys(d) as (keyof PrepareOptions)[]).every((k) => o[k] === d[k]);
}
