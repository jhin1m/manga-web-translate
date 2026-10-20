/**
 * Đoán series + số chương từ tên file thả vào (thuần client, luôn cho người dùng sửa trước khi tạo).
 * - Số chương: số cuối đứng sau tiền tố `chapter|chap|chương|ch|c|ep|화` (hoặc `105화`); không có tiền tố → số
 *   cuối cùng trong tên.
 * - Series: tên series đã có là chuỗi con của tên file (cả hai chuẩn hoá: bỏ dấu, lowercase, chỉ giữ chữ-số);
 *   nhiều series khớp → series có tên dài nhất. Không khớp → null (caller tự chọn series dùng gần nhất).
 */

const PREFIXED = /(?:chapter|chap|chương|chuong|ch|c|ep|화)\s*[._-]?\s*(\d+(?:\.\d+)?)/giu;
const SUFFIXED = /(\d+(?:\.\d+)?)\s*화/gu;
const ANY_NUMBER = /\d+(?:\.\d+)?/g;

/** Tên không đường dẫn, không đuôi. */
const stem = (name: string) => (name.split("/").pop() ?? name).replace(/\.[a-z0-9]+$/i, "");

/** "013" → "13", "12.50" → "12.5". */
const normNumber = (s: string) => String(Number(s));

const lastMatch = (re: RegExp, s: string, group = 0) => {
  let last: string | undefined;
  for (const m of s.matchAll(re)) last = m[group];
  return last;
};

export function parseChapterNumber(name: string): string | null {
  const s = stem(name);
  const n = lastMatch(PREFIXED, s, 1) ?? lastMatch(SUFFIXED, s, 1) ?? lastMatch(ANY_NUMBER, s);
  return n === undefined ? null : normNumber(n);
}

/** Bỏ dấu (đ → d), lowercase, chỉ giữ chữ + số (kể cả Hangul). */
export const normalizeName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

export function matchSeries<T extends { title: string }>(name: string, series: readonly T[]): T | null {
  const file = normalizeName(stem(name));
  let best: T | null = null;
  let bestLen = 0;
  for (const s of series) {
    const t = normalizeName(s.title);
    if (t.length > bestLen && file.includes(t)) {
      best = s;
      bestLen = t.length;
    }
  }
  return best;
}

export function parseChapterFilename<T extends { title: string }>(
  name: string,
  series: readonly T[],
): { series: T | null; number: string | null } {
  return { series: matchSeries(name, series), number: parseChapterNumber(name) };
}
