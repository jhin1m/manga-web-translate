/** Loại gợi ý series do AI học được khi dịch. */
export const SUGGESTION_KINDS = ["term", "pronoun"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/**
 * Chuẩn hoá để so khớp: NFC → trim → gộp khoảng trắng → chữ thường. Không dùng locale để API và web
 * cho cùng một kết quả trên mọi máy.
 */
export function normKey(s: string): string {
  return s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Khoá gợi ý thuật ngữ = nguồn đã chuẩn hoá. */
export function termKey(source: string): string {
  return normKey(source);
}

/** Khoá gợi ý xưng hô: có thứ tự (A→B khác B→A). */
export function pronounKey(speaker: string, listener: string): string {
  return `${normKey(speaker)}→${normKey(listener)}`;
}

/**
 * Khoá trong sổ khoá AI đã gặp (series_suggestions.key) = cặp ngôn ngữ + khoá chuẩn hoá: `"{src}>{tgt}|{key}"`.
 * Đổi cặp ngôn ngữ series thì AI được ghi lại các mục cùng tên nguồn.
 */
export function ledgerKey(sourceLang: string, targetLang: string, key: string): string {
  return `${sourceLang}>${targetLang}|${key}`;
}
