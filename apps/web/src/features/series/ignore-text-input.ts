import { IGNORE_TEXT_ITEMS, ignoreEntryError } from "@mtl/shared";

/** Ô "Chữ bỏ qua": mỗi dòng 1 mục (dòng trống bỏ qua); lỗi đầu tiên theo số dòng (mục thường hoặc regex `/mẫu/`), null = hợp lệ. */
export function parseIgnoreText(raw: string): { list: string[]; error: string | null } {
  const lines = raw.split("\n").map((l) => l.trim());
  const list = lines.filter(Boolean);
  for (const [i, l] of lines.entries()) {
    const reason = l ? ignoreEntryError(l) : null;
    if (reason) return { list, error: `Dòng ${i + 1}: ${reason}.` };
  }
  if (list.length > IGNORE_TEXT_ITEMS) return { list, error: `Tối đa ${IGNORE_TEXT_ITEMS} mục.` };
  return { list, error: null };
}
