import { aiModels, type DbLike } from "@mtl/db";
import type { JobPayload } from "@mtl/shared";
import { and, eq, or } from "drizzle-orm";

/**
 * Bảng giá phía server (red team #2, #14): worker chỉ gửi số đếm thô, tiền tính ở đây.
 * Giá USD / 1M token (vào, ra) — kiểm lại khi đổi model; khớp worker/mtl_pipeline/providers/base.py.
 */
export const LLM_PRICES_PER_MTOK: Readonly<Record<string, { in: number; out: number }>> = {
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
  "gemini-2.5-flash": { in: 0.3, out: 2.5 },
  // Model Premium của AI hiệu đính (worker MTL_*_PREMIUM_MODEL) — giá niêm yết, kiểm lại trước khi bật production.
  "gemini-2.5-pro": { in: 1.25, out: 10 },
  "claude-sonnet-5-5": { in: 3, out: 15 },
  // OpenAI chạy bằng env worker (MTL_OPENAI_*) — giá niêm yết Standard, kiểm lại trước khi bật production.
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1": { in: 2, out: 8 },
};

/**
 * Model lạ không bao giờ tính $0: lấy giá đắt nhất trong bảng (bảo thủ) — người vận hành thêm giá đúng sau.
 */
export function llmPrice(model: string | null): { price: { in: number; out: number }; known: boolean } {
  const known = model ? LLM_PRICES_PER_MTOK[model] : undefined;
  if (known) return { price: known, known: true };
  const all = Object.values(LLM_PRICES_PER_MTOK);
  return {
    price: { in: Math.max(...all.map((p) => p.in)), out: Math.max(...all.map((p) => p.out)) },
    known: false,
  };
}

/**
 * Giá của job: có `payload.llm` → giá admin nhập cho ref `(provider_id, model)`; không có (chạy bằng env worker) →
 * bảng tĩnh y nguyên. Job nhiều ref khác model (`page.ocr_region`: OCR + dịch, `usage.model` chỉ là 1 chuỗi) →
 * max từng chiều trên mọi ref (bảo thủ). Ref không còn trong DB hoặc `usage.model` không khớp ref nào → bảng tĩnh.
 */
export async function llmPriceFor(
  t: DbLike,
  model: string | null,
  payload: JobPayload,
): Promise<{ price: { in: number; out: number }; known: boolean }> {
  const refs = "llm" in payload ? Object.values(payload.llm ?? {}) : [];
  if (refs.length === 0) return llmPrice(model);
  const rows = await t
    .select({
      providerId: aiModels.providerId,
      modelId: aiModels.modelId,
      in: aiModels.priceIn,
      out: aiModels.priceOut,
    })
    .from(aiModels)
    .where(or(...refs.map((r) => and(eq(aiModels.providerId, r.provider_id), eq(aiModels.modelId, r.model)))));
  const distinct = new Set(refs.map((r) => `${r.provider_id}/${r.model}`)).size;
  const candidates = distinct > 1 ? rows : rows.filter((r) => r.modelId === model);
  if (candidates.length === 0) return llmPrice(model);
  return {
    price: { in: Math.max(...candidates.map((r) => r.in)), out: Math.max(...candidates.map((r) => r.out)) },
    known: true,
  };
}

/** USD / giây GPU. Worker Mac (máy người vận hành) → 0; Modal tính theo L4. */
export const GPU_USD_PER_S = { mac: 0, modal: 0.000222 } as const;

/** Trần mỗi call LLM dùng để clamp số đếm worker gửi (≥ max_output_tokens của provider trong worker). */
export const MAX_OUTPUT_TOKENS_PER_CALL = 4096;
export const MAX_INPUT_TOKENS_PER_CALL = 200_000;
