/**
 * Cảnh báo trước khi xuất (thuần, tính từ dữ liệu đã có ở màn chương — không gọi API): trang chưa dịch (lỗi, đang
 * chạy, chờ dịch — đều không có trong file trừ khi chọn đưa ảnh gốc vào), bản dịch trống (bỏ SFX), trang còn "AI
 * có bản mới" chưa áp, khối tràn khung. Mỗi câu nói rõ hậu quả trong file; có cảnh báo vẫn xuất được.
 */
import type { PageStatus } from "./status.ts";
import type { Row } from "./text-table/rows.ts";

export type ExportWarnings = { untranslated: number; overflow: number; empty: number; aiPending: number };

export function exportWarnings(
  pages: { status: PageStatus; ai_update_available: boolean; skipped?: boolean }[],
  rows: Pick<Row, "kind" | "flags">[],
): ExportWarnings {
  const w: ExportWarnings = { untranslated: 0, overflow: 0, empty: 0, aiPending: 0 };
  for (const p of pages) {
    // Trang đã ẩn luôn bị bỏ khi xuất (kể cả khi đưa trang chưa dịch vào) — không có gì để cảnh báo.
    if (p.skipped) continue;
    // Worker chỉ xuất bản dịch của trang `ready`; trang khác bị bỏ (hoặc thành ảnh gốc khi chọn đưa vào).
    if (p.status !== "ready") w.untranslated++;
    if (p.ai_update_available) w.aiPending++;
  }
  for (const r of rows) {
    if (r.flags.includes("overflow")) w.overflow++;
    if (r.flags.includes("empty") && r.kind !== "sfx" && !r.flags.includes("sfx")) w.empty++;
  }
  return w;
}

/** Câu cảnh báo theo thứ tự quan trọng; rỗng = không có gì cần xem. */
export function warningLines(w: ExportWarnings, o: { includeUntranslated: boolean }): string[] {
  const out: string[] = [];
  if (w.untranslated && !o.includeUntranslated) out.push(`${w.untranslated} trang chưa dịch → không có trong file`);
  if (w.empty) out.push(`${w.empty} khối chưa dịch → để trống chữ`);
  if (w.aiPending) out.push(`${w.aiPending} trang AI có bản mới → xuất bản đang hiện`);
  if (w.overflow) out.push(`${w.overflow} khối tràn khung → chữ có thể bị cắt`);
  return out;
}

/** Số chỗ xem được trong bảng văn bản (trang chưa dịch không nằm trong bảng). */
export const reviewCount = (w: ExportWarnings) => w.overflow + w.empty + w.aiPending;
