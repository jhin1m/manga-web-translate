/**
 * Thuần: bản nháp của modal Cài đặt dịch (tự lưu từng trường). Nháp giữ đúng thứ người dùng đang thấy (ô "Chữ bỏ qua"
 * là chuỗi nhiều dòng, hàng xưng hô còn thiếu ô); mốc (`base`) là bản server mà nháp của từng trường được lấy từ đó.
 * Trường nháp khác mốc = đang sửa: không bị bản server mới đè, và mốc xưng hô giữ đúng các cặp form đã thấy để server
 * không xoá cặp AI thêm sau. Hàng xưng hô thiếu ô không được lưu (không tính khi so / gửi) nhưng vẫn ở trên form.
 */
import type { PronounRule, PronounRuleInput, Series } from "./api.ts";
import { parseIgnoreText } from "./ignore-text-input.ts";
import { SETTINGS_FIELDS, type SettingsField, type SettingsValues, sameField } from "./settings-diff.ts";

/** Hàng xưng hô trên form: `origin` chỉ để hiện / ẩn chip AI (không gửi lên); sửa hàng → `"user"`. */
export type FormRule = PronounRuleInput & { origin?: PronounRule["origin"] };
export type Draft = Omit<SettingsValues, "pronoun_rules" | "ignore_text"> & {
  pronoun_rules: FormRule[];
  /** Nội dung ô "Chữ bỏ qua" (mỗi dòng 1 mục). */
  ignore_text: string;
};
export type DraftState = { draft: Draft; base: Draft };

export const toDraft = (s: Series): Draft => ({
  title: s.title,
  source_lang: s.source_lang,
  target_lang: s.target_lang,
  page_format: s.page_format,
  honorific_policy: s.honorific_policy,
  pronoun_rules: s.pronoun_rules,
  style_prompt: s.style_prompt,
  default_fonts: s.default_fonts,
  ignore_text: s.ignore_text.join("\n"),
});

export type RuleField = "speaker" | "listener" | "address";
const RULE_FIELDS: RuleField[] = ["speaker", "listener", "address"];

/** Hàng xưng hô đủ người nói, người nghe, xưng/gọi (ghi chú tuỳ chọn). */
export const ruleComplete = (r: PronounRuleInput) => RULE_FIELDS.every((f) => r[f].trim() !== "");

/** Giá trị đem so / gửi: "Chữ bỏ qua" thành danh sách (dòng trống bỏ qua), xưng hô chỉ gồm hàng đủ ô. */
export const draftValues = (d: Draft): SettingsValues => ({
  ...d,
  pronoun_rules: d.pronoun_rules.filter(ruleComplete),
  ignore_text: parseIgnoreText(d.ignore_text).list,
});

/** Trường `k` của nháp khác mốc. */
export const isDirty = (st: DraftState, k: SettingsField) => !sameField(draftValues(st.draft), draftValues(st.base), k);

/**
 * Trường chưa lưu được: tên trống, "Chữ bỏ qua" sai cú pháp. Xưng hô luôn lưu được (chỉ gửi hàng đủ ô, xem
 * `draftValues`).
 */
export function fieldInvalid(d: Draft, k: SettingsField): boolean {
  if (k === "title") return !d.title.trim();
  if (k === "ignore_text") return parseIgnoreText(d.ignore_text).error !== null;
  return false;
}

/**
 * Giá trị trường `k` khi nhận bản server. Xưng hô: giữ các hàng thiếu ô đang có trên form (chưa lưu nên server không
 * có) ở gần vị trí cũ, để đồng bộ không xoá hàng người dùng đang điền dở.
 */
function fromServer<K extends SettingsField>(draft: Draft, server: Draft, k: K): Draft[K] {
  if (k !== "pronoun_rules") return server[k];
  const rows = [...server.pronoun_rules];
  for (const [i, r] of draft.pronoun_rules.entries()) {
    if (!ruleComplete(r)) rows.splice(Math.min(i, rows.length), 0, r);
  }
  return rows as Draft[K];
}

/**
 * Nhận bản server mới: trường nào nháp chưa sửa (bằng mốc) và không bị giữ (`hold`: đang có con trỏ / đang lưu) thì
 * lấy theo server (xưng hô: cộng hàng thiếu ô của form), mốc của trường đó thành bản server. Trường đang sửa giữ nguyên
 * cả nháp lẫn mốc. Không đổi gì → trả lại đúng `st` (không render lại).
 */
export function adoptServer(
  st: DraftState,
  server: Draft,
  hold: (k: SettingsField) => boolean,
  only: readonly SettingsField[] = SETTINGS_FIELDS,
): DraftState {
  let next = st;
  for (const k of only) {
    if (hold(k) || isDirty(next, k)) continue;
    const shown = fromServer(next.draft, server, k);
    // So cả phần hiển thị (chip AI của cặp xưng hô, dòng trống trong ô chữ), không chỉ nội dung gửi lên.
    if (JSON.stringify(next.draft[k]) === JSON.stringify(shown)) continue;
    next = { draft: { ...next.draft, [k]: shown }, base: { ...next.base, [k]: server[k] } };
  }
  return next;
}
