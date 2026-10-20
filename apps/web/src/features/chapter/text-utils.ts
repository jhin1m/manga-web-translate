/** Hàm thuần cho UI chương: định dạng dung lượng, tách đoạn khớp để highlight. */

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export type TextPart = { text: string; hit: boolean };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Tách `text` thành các đoạn, đánh dấu những đoạn khớp `needle` (không regex). `needle` rỗng → 1 đoạn không khớp. */
export function splitHighlight(text: string, needle: string, caseSensitive: boolean): TextPart[] {
  if (!needle) return [{ text, hit: false }];
  const re = new RegExp(escapeRe(needle), caseSensitive ? "g" : "gi");
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m[0] === "") continue;
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), hit: false });
    parts.push({ text: m[0], hit: true });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts.length ? parts : [{ text, hit: false }];
}

/** Thông điệp lỗi apply/undo theo hợp đồng API (409 preview_stale/undo_conflict, 423 chapter_locked). */
export function describeWriteError(status: number, code: string | undefined, fallback: string): string {
  if (status === 423 || code === "chapter_locked") return "Chương đang được người khác giữ khoá — chỉ xem trước được.";
  if (code === "preview_stale") return "Có trang vừa bị sửa sau lúc xem trước. Hãy bấm “Xem trước” lại rồi áp dụng.";
  if (code === "undo_conflict") return "Không hoàn tác được: một số trang đã được sửa tiếp sau lần áp dụng.";
  if (status === 404) return "Lần áp dụng này không còn để hoàn tác.";
  return fallback;
}
