/**
 * Logic thuần của form nhà cung cấp AI: bản nháp (chuỗi như người dùng gõ) → kiểm tra → body gửi API; so sánh danh
 * sách model khi sửa. Không React → test được.
 */
import {
  AI_PROVIDER_TYPES,
  type AiModelInput,
  type AiProviderInput,
  type AiProviderType,
  ApiKey,
  MAX_PRICE_PER_MTOK,
  normalizeBaseUrl,
  type StructuredOutput,
} from "@mtl/shared";
import { type PriceSuggestion, suggestionFor } from "./price-suggestions.ts";

export const TYPE_LABEL: Record<AiProviderType, string> = {
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  openai: "OpenAI",
  openai_compatible: "OpenAI-compatible (base URL tuỳ chỉnh)",
};
export { AI_PROVIDER_TYPES };

export type ModelDraft = {
  /** Có = model đã lưu (model_id bất biến). */
  id?: string;
  model_id: string;
  price_in: string;
  price_out: string;
  vision: boolean;
  reasoning: boolean;
};

export type ProviderDraft = {
  type: AiProviderType;
  name: string;
  base_url: string;
  /** Tạo: bắt buộc. Sửa: để trống = giữ key cũ. */
  api_key: string;
  structured_output: StructuredOutput;
  models: ModelDraft[];
};

export const emptyModel = (): ModelDraft => ({
  model_id: "",
  price_in: "",
  price_out: "",
  vision: false,
  reasoning: false,
});

export const emptyDraft = (): ProviderDraft => ({
  type: "openai",
  name: "",
  base_url: "",
  api_key: "",
  structured_output: "json_schema",
  models: [],
});

export type SavedModel = {
  id: string;
  model_id: string;
  price_in: number;
  price_out: number;
  vision: boolean;
  reasoning: boolean;
};
export type SavedProvider = {
  id: string;
  type: AiProviderType;
  name: string;
  base_url: string | null;
  key_last4: string;
  /** Đổi khi sửa tên / key / base URL (dùng để bỏ kết quả Kiểm tra cũ). */
  updated_at: string;
  structured_output: StructuredOutput;
  models: SavedModel[];
};

export const draftOf = (p: SavedProvider): ProviderDraft => ({
  type: p.type,
  name: p.name,
  base_url: p.base_url ?? "",
  api_key: "",
  structured_output: p.structured_output,
  models: p.models.map((m) => ({
    id: m.id,
    model_id: m.model_id,
    price_in: String(m.price_in),
    price_out: String(m.price_out),
    vision: m.vision,
    reasoning: m.reasoning,
  })),
});

/**
 * Gợi ý giá cho model có id khớp: chỉ điền ô giá còn TRỐNG (không đè giá admin đã gõ); cờ vision / reasoning lấy
 * theo gợi ý khi cả 2 ô giá đang trống (model mới chọn).
 */
export function applySuggestion(type: string, m: ModelDraft): ModelDraft {
  const s = suggestionFor(type, m.model_id);
  if (!s || m.id) return m;
  const fresh = m.price_in.trim() === "" && m.price_out.trim() === "";
  return {
    ...m,
    price_in: m.price_in.trim() === "" ? String(s.price_in) : m.price_in,
    price_out: m.price_out.trim() === "" ? String(s.price_out) : m.price_out,
    vision: fresh ? s.vision : m.vision,
    reasoning: fresh ? s.reasoning : m.reasoning,
  };
}

export const modelFromSuggestion = (s: PriceSuggestion): ModelDraft => ({
  model_id: s.model_id,
  price_in: String(s.price_in),
  price_out: String(s.price_out),
  vision: s.vision,
  reasoning: s.reasoning,
});

const parsePrice = (v: string): number | null => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE_PER_MTOK ? n : null;
};

const tooBig = (v: string): boolean => Number(v) > MAX_PRICE_PER_MTOK;

export type DraftErrors = { name?: string; base_url?: string; api_key?: string; models: Record<number, string> };

/**
 * `saved` = provider đang sửa (undefined = tạo mới). Đổi base URL khi sửa ⇒ bắt buộc nhập lại key (API cũng chặn).
 */
export function validateDraft(d: ProviderDraft, saved?: SavedProvider): DraftErrors | null {
  const e: DraftErrors = { models: {} };
  if (!d.name.trim()) e.name = "Nhập tên nhà cung cấp.";
  let normalized: string | null = null;
  if (d.type === "openai_compatible") {
    normalized = normalizeBaseUrl(d.base_url);
    if (!d.base_url.trim()) e.base_url = "Nhập base URL.";
    else if (!normalized) e.base_url = "Base URL phải bắt đầu bằng https:// (không kèm user / mật khẩu).";
  }
  const key = d.api_key.trim();
  if (!saved && !key) e.api_key = "Nhập API key.";
  else if (key && !ApiKey.safeParse(key).success)
    e.api_key = "API key không hợp lệ (8–512 ký tự in được, không khoảng trắng).";
  else if (saved && !key && normalized && normalized !== saved.base_url) {
    e.api_key = "Đổi base URL phải nhập lại API key (key cũ không được gửi tới host mới).";
  }
  const seen = new Set<string>();
  d.models.forEach((m, i) => {
    const id = m.model_id.trim();
    if (!id) e.models[i] = "Nhập model id.";
    else if (seen.has(id)) e.models[i] = "Trùng model id.";
    else if (tooBig(m.price_in) || tooBig(m.price_out)) {
      e.models[i] = `Giá tối đa ${MAX_PRICE_PER_MTOK.toLocaleString("en-US")} USD / 1M token (kiểm tra lại số vừa gõ).`;
    } else if (parsePrice(m.price_in) === null || parsePrice(m.price_out) === null) {
      e.models[i] = "Nhập đủ giá vào / ra (USD / 1M token, ≥ 0).";
    }
    seen.add(id);
  });
  return e.name || e.base_url || e.api_key || Object.keys(e.models).length ? e : null;
}

const modelBody = (m: ModelDraft): AiModelInput => ({
  model_id: m.model_id.trim(),
  price_in: parsePrice(m.price_in) ?? 0,
  price_out: parsePrice(m.price_out) ?? 0,
  vision: m.vision,
  reasoning: m.reasoning,
});

/** Body `POST /providers` từ bản nháp đã qua `validateDraft`. */
export const toCreateBody = (d: ProviderDraft): AiProviderInput => ({
  type: d.type,
  name: d.name.trim(),
  ...(d.type === "openai_compatible" ? { base_url: d.base_url.trim() } : {}),
  api_key: d.api_key.trim(),
  structured_output: d.structured_output,
  models: d.models.map(modelBody),
});

/** Body `PATCH /providers/:id`: chỉ trường đổi; key chỉ gửi khi nhập. */
export function toPatchBody(d: ProviderDraft, saved: SavedProvider) {
  const body: { name?: string; base_url?: string; api_key?: string; structured_output?: StructuredOutput } = {};
  if (d.name.trim() !== saved.name) body.name = d.name.trim();
  if (d.type === "openai_compatible") {
    const url = normalizeBaseUrl(d.base_url);
    if (url && url !== saved.base_url) body.base_url = d.base_url.trim();
    if (d.structured_output !== saved.structured_output) body.structured_output = d.structured_output;
  }
  if (d.api_key.trim()) body.api_key = d.api_key.trim();
  return body;
}

export type ModelDiff = {
  add: AiModelInput[];
  patch: { id: string; body: Partial<Pick<AiModelInput, "price_in" | "price_out" | "vision" | "reasoning">> }[];
  remove: { id: string; model_id: string }[];
};

/**
 * Khác biệt danh sách model khi sửa so với bản `saved` MỚI NHẤT từ server (hội tụ khi bấm Lưu lại sau lỗi giữa chừng):
 * dòng nháp khớp model đã lưu theo id — hoặc theo `model_id` nếu chưa có id (vừa thêm ở lần lưu trước, hoặc xoá rồi
 * thêm lại cùng id) — chỉ sửa giá / cờ; dòng không khớp → thêm; model lưu không còn dòng nháp → xoá.
 */
export function diffModels(d: ProviderDraft, saved: SavedProvider): ModelDiff {
  const out: ModelDiff = { add: [], patch: [], remove: [] };
  const kept = new Set<string>();
  for (const m of d.models) {
    const cur = m.id
      ? saved.models.find((x) => x.id === m.id)
      : saved.models.find((x) => x.model_id === m.model_id.trim());
    if (!cur) {
      // Có id mà server không còn (đã xoá ở lần lưu trước) → không làm gì; chưa có id → thêm mới.
      if (!m.id) out.add.push(modelBody(m));
      continue;
    }
    kept.add(cur.id);
    const next = modelBody(m);
    const body: ModelDiff["patch"][number]["body"] = {};
    if (next.price_in !== cur.price_in) body.price_in = next.price_in;
    if (next.price_out !== cur.price_out) body.price_out = next.price_out;
    if (next.vision !== cur.vision) body.vision = next.vision;
    if (next.reasoning !== cur.reasoning) body.reasoning = next.reasoning;
    if (Object.keys(body).length) out.patch.push({ id: cur.id, body });
  }
  for (const m of saved.models) if (!kept.has(m.id)) out.remove.push({ id: m.id, model_id: m.model_id });
  return out;
}
