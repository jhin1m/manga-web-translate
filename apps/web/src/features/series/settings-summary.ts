/** Thuần: tóm tắt một dòng cho các nhóm thu gọn trong Cài đặt series, và tìm trường xưng hô còn thiếu. */
import type { PronounRule } from "./api.ts";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export const styleSummary = (prompt: string) => oneLine(prompt) || "Chưa đặt";

export const rulesSummary = (rules: readonly PronounRule[]) => (rules.length ? `${rules.length} quy tắc` : "Chưa có");

export const countSummary = (n: number, unit: string) => (n ? `${n} ${unit}` : "Chưa có");

export type RuleField = "speaker" | "listener" | "address";
const RULE_FIELDS: RuleField[] = ["speaker", "listener", "address"];

/** Ô xưng hô bắt buộc đầu tiên còn trống (theo thứ tự hàng rồi cột); null = mọi quy tắc đủ. */
export function firstMissingRuleField(rules: readonly PronounRule[]): { index: number; field: RuleField } | null {
  for (const [index, r] of rules.entries()) {
    const field = RULE_FIELDS.find((f) => !r[f].trim());
    if (field) return { index, field };
  }
  return null;
}
