/**
 * Trạng thái page gom về 4 mức người dùng hiểu được (cột trang, panel Chọn) + cờ "cần xem" + nhãn/viền thumbnail.
 * Thuần: chỉ đọc `ProgressPage`.
 */
import { ACTIVE_JOB_STATUSES } from "@mtl/shared";
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

const ACTIVE = new Set<string>(ACTIVE_JOB_STATUSES);

/** Page nằm trong job dịch còn hoạt động — kể cả lúc job còn xếp hàng (page vẫn `prepared`/`ready` tới khi worker nhận). */
export const inTranslateJob = (p: Pick<ProgressPage, "job">) =>
  p.job?.type === "chapter.translate" && ACTIVE.has(p.job.status);

/** Mức hiển thị của page: như `pageLevel`, nhưng page đang chờ job dịch tính là "Đang xử lý". */
export const pageLevelOf = (p: Pick<ProgressPage, "status" | "job">): PageLevel =>
  inTranslateJob(p) && p.status !== "failed" ? "busy" : LEVEL[p.status];

/**
 * Page cần người xem lại: lỗi, AI có bản mới cho page đã sửa tay, hoặc có box chữ tràn khung (`overflow`, đo ở
 * client từ bảng văn bản).
 */
export const needsReview = (p: { status: PageStatus; ai_update_available: boolean }, overflow = false) =>
  p.status === "failed" || p.ai_update_available || overflow;

type ThumbPage = Pick<ProgressPage, "ord" | "status" | "skipped" | "ai_update_available" | "cut_flag" | "job">;

/**
 * Nhãn + viền thumbnail cột trang; trang yên (Chờ dịch / Xong) không có nhãn. Trang đang chạy AI có nhãn bước + `progress`
 * (0..1, null khi job còn xếp hàng) để vẽ thanh tiến độ trong thumbnail.
 */
export type ThumbMark =
  | { tone: "hidden" | "danger" | "warn"; label: "Đã ẩn" | "Lỗi" | "Chờ AI" | "Cần xem" }
  | { tone: "busy"; label: string; progress: number | null }
  | null;

const BUSY_STEP: Partial<Record<PageStatus, string>> = {
  pending: "Bước 1",
  preparing: "Bước 1",
  translating: "Đang dịch",
};

/** Ưu tiên: ẩn > lỗi > chờ AI tự thử lại > đang xử lý > cần xem (AI có bản mới, tràn khung) > bình thường. */
export function thumbMark(p: ThumbPage, overflow: boolean): ThumbMark {
  if (p.skipped) return { tone: "hidden", label: "Đã ẩn" };
  if (p.status === "failed") return { tone: "danger", label: "Lỗi" };
  if (waitingOnProvider(p.job)) return { tone: "warn", label: "Chờ AI" };
  const step = BUSY_STEP[p.status] ?? (inTranslateJob(p) ? "Đang dịch" : undefined);
  if (step) {
    const running = p.job?.status === "running";
    const progress = running ? Math.min(1, Math.max(0, p.job?.progress ?? 0)) : null;
    const label = progress === null ? `${step} · chờ` : `${step} · ${Math.round(progress * 100)}%`;
    return { tone: "busy", label, progress };
  }
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
  const head = `Trang ${p.ord + 1} · ${mark?.label ?? PAGE_LEVEL[pageLevelOf(p)].label}`;
  if (mark?.label !== "Cần xem") return head;
  const flags = thumbFlags(p, overflow).filter((f) => f !== "chờ AI thử lại");
  return flags.length ? `${head}: ${flags.join(", ")}` : head;
}

/** Title thumbnail: câu lỗi job (nếu có) hoặc cờ chi tiết; trang hiện thêm gợi ý menu chuột phải. */
export function thumbTitle(p: ThumbPage, overflow: boolean): string {
  const detail = describeJobError(p.job)?.text ?? thumbFlags(p, overflow).join(" · ");
  const hint = p.skipped ? "Bấm hoặc chuột phải: khôi phục trang" : "Chuột phải: xoá (ẩn) trang";
  return detail ? `${detail}\n${hint}` : hint;
}
