/**
 * Gợi ý giá model OpenAI (USD / 1M token, tầng Standard, ngữ cảnh ≤ 272K) — nguồn
 * https://developers.openai.com/api/docs/pricing , đối chiếu 2026-11-04. Chỉ là gợi ý: admin xác nhận giá thật.
 * Mặc định gợi ý model KHÔNG reasoning (chi phí / trần token dự đoán được); model reasoning có cờ + cảnh báo.
 */
export type PriceSuggestion = {
  model_id: string;
  price_in: number;
  price_out: number;
  vision: boolean;
  reasoning: boolean;
};

export const OPENAI_SUGGESTIONS: readonly PriceSuggestion[] = [
  { model_id: "gpt-4.1-mini", price_in: 0.4, price_out: 1.6, vision: true, reasoning: false },
  { model_id: "gpt-4o-mini", price_in: 0.15, price_out: 0.6, vision: true, reasoning: false },
  { model_id: "gpt-4.1", price_in: 2, price_out: 8, vision: true, reasoning: false },
  { model_id: "gpt-5-mini", price_in: 0.25, price_out: 2, vision: true, reasoning: true },
  { model_id: "gpt-5", price_in: 1.25, price_out: 10, vision: true, reasoning: true },
];

export const suggestionFor = (type: string, modelId: string): PriceSuggestion | undefined =>
  type === "openai" ? OPENAI_SUGGESTIONS.find((s) => s.model_id === modelId.trim()) : undefined;

/** Cảnh báo hiện cạnh model có cờ reasoning (trần token ra của worker gồm cả token suy luận). */
export const REASONING_WARNING =
  "Trần token ra (OCR 2048 / Dịch 4096 / Hiệu đính 3072) gồm cả token suy luận — dễ fail do thiếu token, tốn tiền mà không ra kết quả. Nên dùng model không reasoning.";

/** Ghi chú dưới danh sách model. */
export const UNSUPPORTED_MODELS_NOTE = "Không hỗ trợ model -pro / -codex (chỉ có Responses API).";
