/**
 * Quy tắc xưng hô của series (`series.pronoun_rules`): mỗi phần tử `{ speaker, listener, address, note, origin }`.
 * `origin` do server tự tính (người dùng hay AI ghi) — không nhận từ client, không đưa vào prompt.
 */
import { normKey, type Origin, pronounKey } from "@mtl/shared";

/** Trần số cặp xưng hô mỗi series (khớp giới hạn body PATCH series). */
export const MAX_PRONOUN_RULES = 200;

/** Cặp do người dùng gửi (đã qua zod) hoặc đã lưu, kèm nhãn nguồn. */
export type PronounRuleInput = { speaker: string; listener: string; address: string; note: string };
export type StoredPronounRule = PronounRuleInput & { origin: Origin };

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Dòng JSON đã lưu → cặp có kiểu; dòng cũ chưa có `origin` coi là của người dùng. */
export function readRule(r: Record<string, unknown>): StoredPronounRule {
  return {
    speaker: str(r.speaker),
    listener: str(r.listener),
    address: str(r.address),
    note: str(r.note),
    origin: r.origin === "ai" ? "ai" : "user",
  };
}

export const readRules = (rules: Record<string, unknown>[]): StoredPronounRule[] => rules.map(readRule);

export const ruleKey = (r: { speaker: string; listener: string }) => pronounKey(r.speaker, r.listener);

/** Chuẩn hoá lại khoá client gửi (`pronounKey`): tách ở "→" rồi tính lại; sai dạng thì chỉ chuẩn hoá cả chuỗi. */
export function normalizeRuleKey(key: string): string {
  const parts = key.split("→");
  return parts.length === 2 ? pronounKey(parts[0] ?? "", parts[1] ?? "") : normKey(key);
}

/**
 * Nội dung cặp (bỏ `origin`) theo thứ tự trường cố định — để so "người dùng có đổi thật không": JSONB lưu khoá object
 * theo thứ tự riêng nên không so thẳng chuỗi JSON của dòng đã lưu với body được.
 */
export const ruleContents = (rules: Record<string, unknown>[]): PronounRuleInput[] =>
  readRules(rules).map(({ origin: _origin, ...r }) => r);

/** Bỏ `origin` — dùng cho prompt (giữ nguyên các trường khác như đã lưu). */
export function withoutOrigin(rules: Record<string, unknown>[]): Record<string, unknown>[] {
  return rules.map(({ origin: _origin, ...rest }) => rest);
}

const sameContent = (a: PronounRuleInput, b: PronounRuleInput) =>
  a.speaker === b.speaker && a.listener === b.listener && a.address === b.address && a.note === b.note;

/**
 * Nhãn nguồn cho các cặp client gửi: trùng y nguyên (speaker, listener, address, note) với một cặp AI đang có thì giữ
 * `'ai'`, còn lại `'user'` (sửa bất kỳ trường nào là của người dùng).
 */
export function withOrigins(next: PronounRuleInput[], cur: StoredPronounRule[]): StoredPronounRule[] {
  const ai = cur.filter((r) => r.origin === "ai");
  return next.map((r) => ({
    speaker: r.speaker,
    listener: r.listener,
    address: r.address,
    note: r.note,
    origin: ai.some((a) => sameContent(a, r)) ? "ai" : "user",
  }));
}
