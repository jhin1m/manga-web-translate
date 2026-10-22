import { IGNORE_TEXT_ITEMS, IGNORE_TEXT_MAX, IGNORE_TEXT_MIN, isValidIgnoreEntry } from "@mtl/shared";

/** Ô "Chữ bỏ qua": mỗi dòng 1 mục (dòng trống bỏ qua); lỗi đầu tiên theo số dòng, null = hợp lệ. */
export function parseIgnoreText(raw: string): { list: string[]; error: string | null } {
  const lines = raw.split("\n").map((l) => l.trim());
  const list = lines.filter(Boolean);
  const bad = lines.findIndex((l) => l && !isValidIgnoreEntry(l));
  if (bad >= 0) {
    return {
      list,
      error: `Dòng ${bad + 1}: mỗi mục ${IGNORE_TEXT_MIN}–${IGNORE_TEXT_MAX} ký tự (không tính http://).`,
    };
  }
  if (list.length > IGNORE_TEXT_ITEMS) return { list, error: `Tối đa ${IGNORE_TEXT_ITEMS} mục.` };
  return { list, error: null };
}
