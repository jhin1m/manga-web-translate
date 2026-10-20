/**
 * Trạng thái page gom về 4 mức người dùng hiểu được (rail trang, thanh trên màn chương) + cờ "cần xem".
 * Thuần: chỉ đọc `ProgressPage`.
 */
import type { PageStatus, Tone } from "./status.ts";

export type PageLevel = "todo" | "busy" | "done" | "error";

export const PAGE_LEVEL: Record<PageLevel, { label: string; tone: Tone }> = {
  todo: { label: "Chưa xử lý", tone: "idle" },
  busy: { label: "Đang xử lý", tone: "busy" },
  done: { label: "Xong", tone: "ok" },
  error: { label: "Lỗi", tone: "danger" },
};

const LEVEL: Record<PageStatus, PageLevel> = {
  pending: "todo",
  preparing: "busy",
  prepared: "busy",
  translating: "busy",
  ready: "done",
  failed: "error",
};

export const pageLevel = (s: PageStatus): PageLevel => LEVEL[s];

/**
 * Page cần người xem lại: lỗi, AI có bản mới cho page đã sửa tay, hoặc có box chữ tràn khung (`overflow`, đo ở
 * client từ bảng văn bản).
 */
export const needsReview = (p: { status: PageStatus; ai_update_available: boolean }, overflow = false) =>
  p.status === "failed" || p.ai_update_available || overflow;
