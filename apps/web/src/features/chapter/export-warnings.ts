/**
 * Cảnh báo trước khi xuất (thuần, tính từ dữ liệu đã có ở màn chương — không gọi API): trang lỗi, trang chưa xử
 * lý xong, khối tràn khung, bản dịch trống (bỏ SFX), trang còn "AI có bản mới" chưa áp. Chỉ để thông tin: có
 * cảnh báo vẫn xuất được.
 */
import type { PageStatus } from "./status.ts";
import type { Row } from "./text-table/rows.ts";

export type ExportWarnings = { failed: number; notReady: number; overflow: number; empty: number; aiPending: number };

export function exportWarnings(
  pages: { status: PageStatus; ai_update_available: boolean }[],
  rows: Pick<Row, "kind" | "flags">[],
): ExportWarnings {
  const w: ExportWarnings = { failed: 0, notReady: 0, overflow: 0, empty: 0, aiPending: 0 };
  for (const p of pages) {
    if (p.status === "failed") w.failed++;
    else if (p.status !== "ready") w.notReady++;
    if (p.ai_update_available) w.aiPending++;
  }
  for (const r of rows) {
    if (r.flags.includes("overflow")) w.overflow++;
    if (r.flags.includes("empty") && r.kind !== "sfx" && !r.flags.includes("sfx")) w.empty++;
  }
  return w;
}

/** Câu cảnh báo theo thứ tự quan trọng; rỗng = không có gì cần xem. */
export function warningLines(w: ExportWarnings): string[] {
  const out: string[] = [];
  if (w.failed) out.push(`${w.failed} trang lỗi xử lý`);
  if (w.notReady) out.push(`${w.notReady} trang chưa xử lý xong`);
  if (w.overflow) out.push(`${w.overflow} khối tràn khung`);
  if (w.empty) out.push(`${w.empty} khối chưa có bản dịch`);
  if (w.aiPending) out.push(`${w.aiPending} trang có bản AI mới chưa áp`);
  return out;
}
