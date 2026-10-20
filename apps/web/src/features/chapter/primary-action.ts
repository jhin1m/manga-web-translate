/**
 * Nút chính (+ menu phụ) của màn chương theo trạng thái: Tải ảnh → Dịch chương → (đang dịch: Xuất khoá) → Xuất.
 * Tiến độ nằm ở chip trạng thái (status.ts chapterChip), nút chính chỉ là bước tiếp theo.
 * Thuần: nhận trạng thái chương, upload phía client và số trang; không gọi API.
 */
import type { ChapterStatus } from "../series/api.ts";
import type { UploadView } from "./next-action.ts";

export type ChapterCommand = "upload" | "commit" | "retry" | "retranslate" | "cancel" | "export";

export type PrimaryAction = {
  command: ChapterCommand;
  label: string;
  disabled: boolean;
  title?: string;
  menu: { command: ChapterCommand; label: string }[];
};

export function primaryAction(input: {
  status: ChapterStatus;
  /** Số ảnh nguồn đã khai báo (chương nháp). */
  sourceFiles: number;
  upload: UploadView | null;
  pages: number;
  /** Trang đã xong (AI). */
  ready: number;
}): PrimaryAction {
  const { status, upload } = input;
  const retranslate = { command: "retranslate" as const, label: "Dịch lại cả chương" };
  if (status === "draft") {
    if (upload?.phase === "uploading") {
      return {
        command: "commit",
        label: "Dịch chương",
        disabled: true,
        title: `Chờ tải xong ảnh (${upload.done}/${upload.total})`,
        menu: [],
      };
    }
    if (input.sourceFiles === 0 || upload?.phase === "failed" || upload?.phase === "incomplete") {
      return { command: "upload", label: "Tải ảnh", disabled: false, menu: [] };
    }
    return { command: "commit", label: "Dịch chương", disabled: false, menu: [] };
  }
  if (status === "ingesting" || status === "processing") {
    return {
      command: "export",
      label: "Xuất",
      disabled: true,
      title: status === "ingesting" ? "Đang cắt trang — dịch xong mới xuất được" : "Dịch xong mới xuất được",
      menu: [{ command: "cancel", label: "Huỷ xử lý" }],
    };
  }
  if (status === "partial_failed") {
    // Lỗi ở bước cắt trang (chưa có page): "Chạy lại trang lỗi" không có gì để chạy — commit lại = ingest lại từ
    // ảnh đã tải (API chỉ cho commit lại chương ingest lỗi).
    if (input.pages === 0) {
      return input.sourceFiles > 0
        ? {
            command: "commit",
            label: "Chạy lại cắt trang",
            disabled: false,
            title: "Cắt trang lỗi — cắt lại từ ảnh đã tải",
            menu: [],
          }
        : { command: "upload", label: "Tải ảnh", disabled: false, menu: [] };
    }
    return {
      command: "retry",
      label: "Chạy lại trang lỗi",
      disabled: false,
      menu: [{ command: "export", label: "Xuất" }, retranslate],
    };
  }
  // review / done
  return { command: "export", label: "Xuất", disabled: input.pages === 0, menu: input.pages > 0 ? [retranslate] : [] };
}
