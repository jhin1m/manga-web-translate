/**
 * Đoán series + số chương từ tên file thả vào (thuần client, luôn cho người dùng sửa trước khi tạo).
 * - Số chương: số cuối đứng sau tiền tố `chapter|chap|chương|ch|c|ep|화` (hoặc `105화`); không có tiền tố → số
 *   cuối cùng trong tên.
 * - Series: tên series đã có là chuỗi con của tên file (cả hai chuẩn hoá: bỏ dấu, lowercase, chỉ giữ chữ-số);
 *   nhiều series khớp → series có tên dài nhất. Không khớp → null (caller tự chọn series dùng gần nhất).
 */

// Không đứng ngay sau một chữ cái: "Arc 2" không phải "c 2" (nhưng "manga_c12", "s2_ch10" vẫn khớp).
const PREFIXED = /(?<!\p{L})(?:chapter|chap|chương|chuong|ch|c|ep|화)\s*[._-]?\s*(\d+(?:\.\d+)?)/giu;
const SUFFIXED = /(\d+(?:\.\d+)?)\s*화/gu;
const ANY_NUMBER = /\d+(?:\.\d+)?/g;

/** Đuôi file thật (ảnh / lưu trữ): tên folder như "Ch 12.5" hay "St.Louis" không bị cắt nhầm. */
const FILE_EXT = /\.(?:zip|cbz|rar|7z|png|jpe?g|webp|gif|bmp|avif|tiff?)$/i;

/** Tên không đường dẫn, không đuôi file. */
const stem = (name: string) => (name.split("/").pop() ?? name).replace(FILE_EXT, "");

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

const MAX_TITLE = 200;
const JOINERS = "_.:|·–—\\-";
const JOINER_RUN = new RegExp(`(?:\\s*[${JOINERS}]+\\s*){2,}`, "gu");
const JOINER_EDGE = new RegExp(`^[\\s${JOINERS}]+|[\\s${JOINERS}]+$`, "gu");
const ONLY_NUMBER = /^\d+(?:\.\d+)?$/;

/** Bỏ tên series ở đầu: ăn dần từng từ tới khi phần đã ăn chuẩn hoá bằng tên series; không khớp → giữ nguyên. */
function stripSeriesPrefix(s: string, seriesTitle: string): string {
  const want = normalizeName(seriesTitle);
  if (!want) return s;
  const parts = s.split(/(\s+)/);
  let eaten = "";
  for (let i = 0; i < parts.length; i++) {
    eaten += parts[i];
    const got = normalizeName(eaten);
    if (got === want) return parts.slice(i + 1).join("");
    if (got.length > want.length) break;
  }
  return s;
}

/**
 * Tên chương từ tên folder / ZIP: bỏ đuôi, cụm số chương (`ch 105`, `105화`), tên series ở đầu và ký tự nối thừa.
 * Thận trọng: không khớp tên series ở đầu thì giữ nguyên; chỉ còn số → "" (UI hiện "Ch.N").
 */
export function chapterTitleFrom(name: string, seriesTitle: string): string {
  let s = stem(name);
  // Bỏ cụm số chương cuối cùng (có tiền tố / hậu tố); số trần giữ nguyên để không xoá số trong tiêu đề.
  for (const re of [PREFIXED, SUFFIXED]) {
    const last = [...s.matchAll(re)].pop();
    if (last?.index !== undefined) {
      s = s.slice(0, last.index) + s.slice(last.index + last[0].length);
      break;
    }
  }
  s = stripSeriesPrefix(s.trim(), seriesTitle);
  s = s.replace(JOINER_RUN, " - ").replace(JOINER_EDGE, "").replace(/\s+/g, " ");
  if (!s || ONLY_NUMBER.test(s)) return "";
  return s.slice(0, MAX_TITLE);
}
