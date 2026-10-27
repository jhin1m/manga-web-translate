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

/** USD / giây GPU. Worker Mac (máy người vận hành) → 0; Modal tính theo L4. */
export const GPU_USD_PER_S = { mac: 0, modal: 0.000222 } as const;

/** Trần mỗi call LLM dùng để clamp số đếm worker gửi (≥ max_output_tokens của provider trong worker). */
export const MAX_OUTPUT_TOKENS_PER_CALL = 4096;
export const MAX_INPUT_TOKENS_PER_CALL = 200_000;
