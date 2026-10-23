/**
 * Mọi chữ cái tiếng Việt (NFC, hoa + thường) kể cả dấu chồng — cùng thuật toán và thứ tự với
 * `vietnamese_chars()` ở worker/mtl_pipeline/fonts.py; cả hai được so với worker/fonts/vietnamese-chars.txt.
 */
export function vietnameseChars(): string {
  const bases = "aăâeêioôơuưy";
  const tones = ["", "̀", "́", "̃", "̉", "̣"];
  const chars = new Set<string>(["đ", "Đ"]);
  for (const b of bases) {
    for (const t of tones) {
      const c = (b + t).normalize("NFC");
      chars.add(c);
      chars.add(c.toUpperCase());
    }
  }
  // Python sorted() so theo code point; JS sort mặc định so theo UTF-16 — cùng thứ tự với ký tự BMP.
  return [...chars].sort((a, b) => (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0)).join("");
}
