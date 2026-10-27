/** Lời nhắn của luồng "ẩn chữ khớp trong chương đã dịch" (thuần, test được). */
import type { IgnoreApplied, IgnorePreview, IgnoreSkipReason, IgnoreUndone } from "./api.ts";

type Skipped = { number: string; reason: IgnoreSkipReason; pages?: number };

const REASON: Record<IgnoreSkipReason, (s: Skipped) => string> = {
  locked: () => "đang mở sửa ở tab khác",
  busy: () => "đang chạy job",
  changed: (s) => (s.pages ? `${s.pages} trang đã đổi sau đó` : "đã đổi sau khi xem trước"),
};

/** "Chương 3 (đang chạy job), Chương 5 (đang mở sửa ở tab khác)" — rỗng nếu không bỏ qua chương nào. */
export const describeSkipped = (skipped: Skipped[]) =>
  skipped.map((s) => `Chương ${s.number} (${REASON[s.reason](s)})`).join(", ");

export const previewSummary = (p: IgnorePreview) =>
  p.total_boxes === 0
    ? "Không có box nào cần ẩn."
    : `Sẽ ẩn ${p.total_boxes} box ở ${p.chapters.length} chương. Chữ dịch giữ nguyên, hoàn tác được.`;

export const appliedSummary = (r: IgnoreApplied) =>
  r.chapters.length === 0 ? "Chưa ẩn box nào." : `Đã ẩn ${r.boxes} box ở ${r.chapters.length} chương`;

export const undoneSummary = (r: IgnoreUndone) =>
  r.chapters.length === 0
    ? "Không khôi phục được trang nào."
    : `Đã hoàn tác ${r.pages} trang ở ${r.chapters.length} chương.`;
