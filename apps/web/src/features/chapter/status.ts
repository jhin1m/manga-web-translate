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

/** Trạng thái không còn thay đổi nếu không có thao tác người dùng → dừng polling. */
export const isChapterSettled = (s: ChapterStatus | undefined) =>
  s === "draft" || s === "review" || s === "partial_failed" || s === "done";
