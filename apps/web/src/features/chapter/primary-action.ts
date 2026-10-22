/**
 * Nút chính (+ menu phụ) của màn chương theo trạng thái: Tải ảnh → Bước 1 (cắt trang + xoá chữ + OCR) → Bước 2
 * (dịch) → (đang chạy: Xuất khoá) → Xuất.
 * Tiến độ nằm ở chip trạng thái (status.ts chapterChip), nút chính chỉ là bước tiếp theo.
 * Thuần: nhận trạng thái chương, upload phía client và số trang; không gọi API.
 */
import type { ChapterStatus } from "../series/api.ts";
import type { UploadView } from "./next-action.ts";

export type ChapterCommand = "upload" | "commit" | "translate" | "retry" | "retranslate" | "cancel" | "export";

export type PrimaryAction = {
  command: ChapterCommand;
  label: string;
  disabled: boolean;
  title?: string;
  menu: { command: ChapterCommand; label: string }[];
};

const STEP1: PrimaryAction = {
  command: "commit",
  label: "Bước 1 · Xoá chữ + OCR",
  disabled: false,
  title: "Ghép & cắt trang, xoá chữ, OCR — chưa dịch",
  menu: [],
};

export function primaryAction(input: {
  status: ChapterStatus;
  /** Số ảnh nguồn đã khai báo (chương nháp). */
  sourceFiles: number;
  upload: UploadView | null;
  pages: number;
  /** Trang đã xong (AI). */
  ready: number;
  /** Trang lỗi. */
  failed: number;
}): PrimaryAction {
  const { status, upload } = input;
  const retranslate = { command: "retranslate" as const, label: "Dịch lại cả chương" };
  if (status === "draft") {
    if (upload?.phase === "uploading") {
      return {
        ...STEP1,
        disabled: true,
        title: `Chờ tải xong ảnh (${upload.done}/${upload.total})`,
      };
    }
    if (input.sourceFiles === 0 || upload?.phase === "failed" || upload?.phase === "incomplete") {
      return { command: "upload", label: "Tải ảnh", disabled: false, menu: [] };
    }
    return STEP1;
  }
  if (status === "prepared") {
    return {
      command: "translate",
      label: "Bước 2 · Dịch",
      disabled: false,
      title: "Dịch + chèn chữ các trang đã OCR (dùng AI)",
      menu: input.failed > 0 ? [{ command: "retry", label: "Chạy lại trang lỗi" }] : [],
    };
  }
  if (status === "ingesting" || status === "processing") {
    return {
      command: "export",
      label: "Xuất",
      disabled: true,
      title: status === "ingesting" ? "Đang cắt trang — xong bước 2 mới xuất được" : "Xong bước 2 mới xuất được",
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
            label: "Chạy lại bước 1",
            disabled: false,
            title: "Cắt trang lỗi — chạy lại bước 1 từ ảnh đã tải",
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
