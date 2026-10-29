/** Nhãn + tông màu trạng thái chương/page (CSS .status[data-tone]). */
import type { ChapterStatus } from "../series/api.ts";
import type { ChapterRun } from "./api.ts";
import type { UploadView } from "./next-action.ts";

export type Tone = "ok" | "busy" | "warn" | "danger" | "idle";

export const CHAPTER_STATUS: Record<ChapterStatus, { label: string; tone: Tone }> = {
  draft: { label: "Nháp (chưa commit)", tone: "idle" },
  ingesting: { label: "Đang cắt trang", tone: "busy" },
  processing: { label: "Đang xử lý", tone: "busy" },
  prepared: { label: "Chờ dịch", tone: "idle" },
  review: { label: "Chờ duyệt", tone: "ok" },
  partial_failed: { label: "Có trang lỗi", tone: "danger" },
  done: { label: "Xong", tone: "ok" },
};

export type PageStatus = "pending" | "preparing" | "prepared" | "translating" | "ready" | "failed";

/** Trạng thái không còn thay đổi nếu không có thao tác người dùng → dừng polling. */
export const isChapterSettled = (s: ChapterStatus | undefined) =>
  s === "draft" || s === "prepared" || s === "review" || s === "partial_failed" || s === "done";

/**
 * Chip trạng thái ở thanh trên màn chương — chỗ duy nhất nói chương đang ở đâu ("Đang dịch · 4/33 trang · lô 2/9",
 * "Chờ duyệt · 2 cần xem", "Xong"); rail chỉ giữ trạng thái theo trang. Thuần.
 */
export function chapterChip(input: {
  status: ChapterStatus;
  pages: number;
  ready: number;
  failed: number;
  /** Trang cần xem (page-status.needsReview). */
  review: number;
  /** Trang chưa xoá chữ + OCR xong (chờ / đang chạy). */
  preparing: number;
  upload: UploadView | null;
  /** Lượt dịch đang mở (progress `chapter.run`). */
  run?: ChapterRun | null;
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
    case "processing": {
      const run = input.run;
      const prep = { label: `Xoá chữ + OCR ${pages - input.preparing}/${pages}`, tone: "busy" as const };
      // Lượt "Chỉ xoá chữ + OCR" không dịch gì.
      if (run?.target === "prepared") return prep;
      // Lô dịch đầu chạy khi trang sau còn xoá chữ → nói về lượt dịch; chưa có lô nào → còn đang xoá chữ.
      if (run && (run.batch > 0 || input.preparing === 0)) {
        const lot = run.batches > 1 ? ` · lô ${run.batch}/${run.batches}` : "";
        return { label: `Đang dịch · ${run.total - run.remaining}/${run.total} trang${lot}`, tone: "busy" };
      }
      if (input.preparing > 0) return prep;
      return { label: pages ? `Đang dịch ${input.ready}/${pages}` : "Đang dịch", tone: "busy" };
    }
    case "prepared":
      return {
        label: `Chờ dịch${input.failed ? ` · lỗi ${input.failed} trang` : ""}`,
        tone: input.failed ? "warn" : "idle",
      };
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
