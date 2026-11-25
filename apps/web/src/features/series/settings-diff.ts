/**
 * Thuần: body PATCH của Cài đặt dịch = các trường khác mốc (so sâu), kèm khoá các cặp xưng hô form đã thấy (cặp của
 * mốc). Chỉ gửi trường đã đổi để không đè mất Giọng văn / cặp xưng hô AI ghi sau khi form nhận mốc; server giữ cặp
 * đang có mà form chưa thấy (khoá không thuộc `pronoun_keys_seen`).
 */
import { pronounKey } from "@mtl/shared";
import type { PronounRuleInput, SeriesPatch, SeriesSettingsInput } from "./api.ts";

/** Giá trị form đem so: cặp xưng hô có thể mang thêm `origin` (bỏ qua khi so và khi gửi). */
export type SettingsValues = Omit<SeriesSettingsInput, "pronoun_rules"> & {
  title: string;
  pronoun_rules: readonly PronounRuleInput[];
};

export const SETTINGS_FIELDS = [
  "title",
  "source_lang",
  "target_lang",
  "page_format",
  "honorific_policy",
  "pronoun_rules",
  "style_prompt",
  "default_fonts",
  "ignore_text",
] as const satisfies readonly (keyof SettingsValues)[];
export type SettingsField = (typeof SETTINGS_FIELDS)[number];

/** Chỉ nội dung cặp, thứ tự trường cố định. */
const ruleContent = ({ speaker, listener, address, note }: PronounRuleInput): PronounRuleInput => ({
  speaker,
  listener,
  address,
  note,
});

/** So sâu dữ liệu JSON (object so theo tập khoá, không theo thứ tự khoá). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a);
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return ka.length === Object.keys(b).length && ka.every((k) => k in rb && deepEqual(ra[k], rb[k]));
}

const comparable = (v: SettingsValues, k: SettingsField): unknown =>
  k === "pronoun_rules" ? v.pronoun_rules.map(ruleContent) : v[k];

/** Trường `k` của hai bản có cùng nội dung (bỏ qua `origin` của cặp xưng hô, thứ tự khoá object). */
export const sameField = (a: SettingsValues, b: SettingsValues, k: SettingsField) =>
  deepEqual(comparable(a, k), comparable(b, k));

/**
 * Trường đổi so với `base` (chỉ xét `only` nếu có) + `pronoun_keys_seen`; không đổi gì → `null` (không gọi API).
 */
export function buildPatch(
  base: SettingsValues,
  form: SettingsValues,
  only: readonly SettingsField[] = SETTINGS_FIELDS,
): SeriesPatch | null {
  const patch: SeriesPatch = {};
  let changed = false;
  for (const k of only) {
    if (sameField(base, form, k)) continue;
    const next = comparable(form, k);
    // `next` lấy từ đúng trường `k` của form (cặp xưng hô đã bỏ `origin`).
    Object.assign(patch, { [k]: next });
    changed = true;
  }
  if (!changed) return null;
  patch.pronoun_keys_seen = base.pronoun_rules.map((r) => pronounKey(r.speaker, r.listener));
  return patch;
}
