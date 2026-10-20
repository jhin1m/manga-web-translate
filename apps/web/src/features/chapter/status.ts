/** Nhãn + tông màu trạng thái chương/page (CSS .status[data-tone]). */
import type { ChapterStatus } from "../series/api.ts";

export type Tone = "ok" | "busy" | "warn" | "danger" | "idle";

export const CHAPTER_STATUS: Record<ChapterStatus, { label: string; tone: Tone }> = {
  draft: { label: "Nháp (chưa commit)", tone: "idle" },
  ingesting: { label: "Đang cắt trang", tone: "busy" },
  processing: { label: "Đang xử lý", tone: "busy" },
  review: { label: "Chờ duyệt", tone: "ok" },
  partial_failed: { label: "Có trang lỗi", tone: "danger" },
  done: { label: "Xong", tone: "ok" },
};

export type PageStatus = "pending" | "preparing" | "prepared" | "translating" | "ready" | "failed";

/** Page đi qua 2 giai đoạn: 1 = detect/xoá chữ/OCR theo trang, 2 = dịch theo chương. */
export const PAGE_STATUS: Record<PageStatus, { label: string; tone: Tone; stage: 1 | 2 | null }> = {
  pending: { label: "GĐ1 · chờ", tone: "idle", stage: 1 },
  preparing: { label: "GĐ1 · xoá chữ + OCR", tone: "busy", stage: 1 },
  prepared: { label: "GĐ2 · chờ dịch", tone: "idle", stage: 2 },
  translating: { label: "GĐ2 · đang dịch", tone: "busy", stage: 2 },
  ready: { label: "Sẵn sàng", tone: "ok", stage: null },
  failed: { label: "Lỗi", tone: "danger", stage: null },
};

/** Trạng thái không còn thay đổi nếu không có thao tác người dùng → dừng polling. */
export const isChapterSettled = (s: ChapterStatus | undefined) =>
  s === "draft" || s === "review" || s === "partial_failed" || s === "done";
