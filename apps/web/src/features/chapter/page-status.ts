/**
 * Trạng thái page gom về 4 mức người dùng hiểu được (cột trang, panel Chọn) + cờ "cần xem" + nhãn/viền thumbnail.
 * Thuần: chỉ đọc `ProgressPage`.
 */
import type { ProgressPage } from "./api.ts";
import { describeJobError, waitingOnProvider } from "./job-error.ts";
import type { PageStatus, Tone } from "./status.ts";

export type PageLevel = "todo" | "busy" | "done" | "error";

export const PAGE_LEVEL: Record<PageLevel, { label: string; tone: Tone }> = {
  todo: { label: "Chờ dịch", tone: "idle" },
  busy: { label: "Đang xử lý", tone: "busy" },
  done: { label: "Xong", tone: "ok" },
  error: { label: "Lỗi", tone: "danger" },
};

const LEVEL: Record<PageStatus, PageLevel> = {
  pending: "busy",
  preparing: "busy",
  prepared: "todo",
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

type ThumbPage = Pick<ProgressPage, "ord" | "status" | "skipped" | "ai_update_available" | "cut_flag" | "job">;

/** Nhãn + viền thumbnail cột trang; trang bình thường (Chờ dịch / Đang xử lý / Xong) không có nhãn. */
export type ThumbMark = { tone: "hidden" | "danger" | "warn"; label: "Đã ẩn" | "Lỗi" | "Chờ AI" | "Cần xem" } | null;

/** Ưu tiên: ẩn > lỗi > chờ AI tự thử lại > cần xem (AI có bản mới, tràn khung) > bình thường. */
export function thumbMark(p: ThumbPage, overflow: boolean): ThumbMark {
  if (p.skipped) return { tone: "hidden", label: "Đã ẩn" };
  if (p.status === "failed") return { tone: "danger", label: "Lỗi" };
  if (waitingOnProvider(p.job)) return { tone: "warn", label: "Chờ AI" };
  if (needsReview(p, overflow)) return { tone: "warn", label: "Cần xem" };
  return null;
}

/** Cờ chi tiết của trang (title thumbnail, tên truy cập). */
export function thumbFlags(p: ThumbPage, overflow: boolean): string[] {
  return [
    p.ai_update_available && "AI có bản mới",
    overflow && "tràn khung",
    p.cut_flag && "cắt ở trần chiều cao",
    waitingOnProvider(p.job) && "chờ AI thử lại",
  ].filter((f): f is string => !!f);
}

/** Tên truy cập luôn đủ trạng thái: "Trang 3 · Xong", "Trang 2 · Cần xem: tràn khung", "Trang 7 · Lỗi". */
export function thumbAria(p: ThumbPage, overflow: boolean): string {
  const mark = thumbMark(p, overflow);
  const head = `Trang ${p.ord + 1} · ${mark?.label ?? PAGE_LEVEL[pageLevel(p.status)].label}`;
  if (mark?.label !== "Cần xem") return head;
  const flags = thumbFlags(p, overflow).filter((f) => f !== "chờ AI thử lại");
  return flags.length ? `${head}: ${flags.join(", ")}` : head;
}

/** Title thumbnail: câu lỗi job (nếu có) hoặc cờ chi tiết; trang hiện thêm gợi ý menu chuột phải. */
export function thumbTitle(p: ThumbPage, overflow: boolean): string {
  const detail = describeJobError(p.job)?.text ?? thumbFlags(p, overflow).join(" · ");
  const hint = p.skipped ? "Bấm hoặc chuột phải: khôi phục trang" : "Chuột phải: ẩn trang";
  return detail ? `${detail}\n${hint}` : hint;
}
