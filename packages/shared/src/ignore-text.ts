/**
 * Chữ bỏ qua của series (watermark, URL nhóm dịch): vùng OCR có chữ chứa một mục trong danh sách → không dịch, không
 * box, không hiện ở bảng văn bản. Thuần, dùng chung api (lọc lúc claim) + web (bảng văn bản).
 */

export const IGNORE_TEXT_MIN = 3;
export const IGNORE_TEXT_MAX = 100;
export const IGNORE_TEXT_ITEMS = 50;

/** NFC + chữ thường + bỏ `http(s)://` + gộp khoảng trắng — OCR hay mất scheme, đổi hoa/thường, thừa dấu cách. */
export const normalizeIgnoreText = (s: string) =>
  s
    .normalize("NFC")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Mục hợp lệ: đo độ dài trên dạng **đã chuẩn hoá** (dạng dùng để so) theo ký tự — "http://a" (còn "a") hay 1 chữ
 * Việt dạng NFD (3 code unit) không lọt qua ngưỡng tối thiểu để nuốt cả thoại.
 */
export function isValidIgnoreEntry(entry: string): boolean {
  const n = [...normalizeIgnoreText(entry)].length;
  return n >= IGNORE_TEXT_MIN && n <= IGNORE_TEXT_MAX;
}

/** Chữ khớp khi (đã chuẩn hoá) chứa một mục (đã chuẩn hoá, không rỗng). */
export function isIgnoredText(text: string, list: readonly string[]): boolean {
  if (!list.length) return false;
  const t = normalizeIgnoreText(text);
  return list.some((entry) => {
    const n = normalizeIgnoreText(entry);
    return n.length > 0 && t.includes(n);
  });
}

/** Trim + bỏ mục trùng (không phân biệt hoa/thường, giữ mục đầu). */
export function cleanIgnoreList(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const v = raw.trim();
    const k = normalizeIgnoreText(v);
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}
