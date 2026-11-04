/**
 * Nhà cung cấp AI do admin cấu hình (Cài đặt → AI): loại, base URL, model + giá, 3 slot tác vụ.
 * Hằng dùng chung cho CHECK ở DB, zod ở API và form ở web.
 */
import { z } from "zod";

export const AI_PROVIDER_TYPES = ["anthropic", "gemini", "openai", "openai_compatible"] as const;
export type AiProviderType = (typeof AI_PROVIDER_TYPES)[number];

/** json_schema = `response_format` json_schema (worker tự hạ json_object 1 lần khi endpoint từ chối); json_object cho endpoint bỏ qua response_format. */
export const STRUCTURED_OUTPUTS = ["json_schema", "json_object"] as const;
export type StructuredOutput = (typeof STRUCTURED_OUTPUTS)[number];

export const AI_TASK_SLOTS = ["ocr", "translate", "proofread"] as const;
export type AiTaskSlot = (typeof AI_TASK_SLOTS)[number];
/** Slot nhận ảnh → model phải có cờ vision. */
export const VISION_SLOTS: readonly AiTaskSlot[] = ["ocr", "proofread"];

/** Ký tự in được ASCII, không khoảng trắng / zero-width / xuống dòng giữa key. */
export const ApiKey = z
  .string()
  .trim()
  .regex(/^[\x21-\x7e]{8,512}$/);

/**
 * Chuẩn hoá base URL của endpoint tương thích OpenAI: bắt buộc `https:`, không user/pass; bỏ query, hash và `/` cuối.
 * Không hợp lệ → null.
 */
export function normalizeBaseUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return null;
  return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
}

const BaseUrl = z
  .string()
  .max(512)
  .refine((v) => normalizeBaseUrl(v) !== null, "base_url phải là URL https:// không kèm user/mật khẩu")
  .transform((v) => normalizeBaseUrl(v) ?? "");

/** Trần giá nhập (USD / 1M token) — chặn gõ nhầm. */
export const MAX_PRICE_PER_MTOK = 100_000;
const Price = z.number().finite().nonnegative().max(MAX_PRICE_PER_MTOK);

export const AiModelInput = z.strictObject({
  model_id: z.string().trim().min(1).max(128),
  /** USD / 1M token. */
  price_in: Price,
  price_out: Price,
  vision: z.boolean().default(false),
  reasoning: z.boolean().default(false),
});
export type AiModelInput = z.infer<typeof AiModelInput>;

/** Sửa model: `model_id` bất biến (payload job tham chiếu theo chuỗi model). */
export const AiModelPatch = z.strictObject({
  price_in: Price.optional(),
  price_out: Price.optional(),
  vision: z.boolean().optional(),
  reasoning: z.boolean().optional(),
});
export type AiModelPatch = z.infer<typeof AiModelPatch>;

const Name = z.string().trim().min(1).max(80);

export const AiProviderInput = z
  .strictObject({
    type: z.enum(AI_PROVIDER_TYPES),
    name: Name,
    base_url: BaseUrl.optional(),
    api_key: ApiKey,
    structured_output: z.enum(STRUCTURED_OUTPUTS).default("json_schema"),
    models: z.array(AiModelInput).max(50).default([]),
  })
  .superRefine((v, ctx) => {
    if ((v.type === "openai_compatible") !== (v.base_url !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["base_url"], message: "chỉ openai_compatible có base_url (và bắt buộc)" });
    }
    const seen = new Set<string>();
    v.models.forEach((m, i) => {
      if (seen.has(m.model_id))
        ctx.addIssue({ code: "custom", path: ["models", i, "model_id"], message: "trùng model" });
      seen.add(m.model_id);
    });
  });
export type AiProviderInput = z.infer<typeof AiProviderInput>;

/** `type` bất biến; đổi `base_url` bắt buộc kèm `api_key` (API kiểm). */
export const AiProviderPatch = z.strictObject({
  name: Name.optional(),
  base_url: BaseUrl.optional(),
  api_key: ApiKey.optional(),
  structured_output: z.enum(STRUCTURED_OUTPUTS).optional(),
});
export type AiProviderPatch = z.infer<typeof AiProviderPatch>;

/** Gán model (id `ai_models`) cho 3 tác vụ; null = mặc định (env worker). */
export const AiSlots = z.strictObject({
  ocr: z.uuid().nullable(),
  translate: z.uuid().nullable(),
  proofread: z.uuid().nullable(),
});
export type AiSlots = z.infer<typeof AiSlots>;

export const PROBE_REASONS = ["ok", "auth", "not_found", "quota", "network", "redirect", "unknown"] as const;
export type ProbeReason = (typeof PROBE_REASONS)[number];
