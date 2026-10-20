/** Nhãn + tông màu trạng thái chương/page (CSS .status[data-tone]). */
import type { ChapterStatus } from "../series/api.ts";
import type { UploadView } from "./next-action.ts";

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

/**
 * Chip trạng thái ở thanh trên màn chương — chỗ duy nhất nói chương đang ở đâu ("Đang dịch 3/5", "Chờ duyệt · 2
 * cần xem", "Xong"); rail chỉ giữ trạng thái theo trang. Thuần.
 */
export function chapterChip(input: {
  status: ChapterStatus;
  pages: number;
  ready: number;
  failed: number;
  /** Trang cần xem (page-status.needsReview). */
  review: number;
  upload: UploadView | null;
}): { label: string; tone: Tone } {
  const { status, pages, upload } = input;
  const review = input.review ? ` · ${input.review} cần xem` : "";
  switch (status) {
    case "draft":
      if (upload?.phase === "uploading") return { label: `Đang tải ảnh ${upload.done}/${upload.total}`, tone: "busy" };
      if (upload?.phase === "failed" || upload?.phase === "incomplete")
        return { label: `Tải dở ${upload.done}/${upload.total} ảnh`, tone: "warn" };
      return { label: "Nháp", tone: "idle" };
    case "ingesting":
      return { label: "Đang cắt trang", tone: "busy" };
    case "processing":
      return { label: pages ? `Đang dịch ${input.ready}/${pages}` : "Đang dịch", tone: "busy" };
    case "partial_failed":
      return pages
        ? { label: `Lỗi ${input.failed} trang${review}`, tone: "danger" }
        : { label: "Cắt trang lỗi", tone: "danger" };
    case "review":
      return { label: `Chờ duyệt${review}`, tone: review ? "warn" : "ok" };
    case "done":
      return { label: `Xong${review}`, tone: review ? "warn" : "ok" };
  }
}
