/**
 * Nút chính (+ menu phụ) của màn chương theo trạng thái: Tải ảnh → Dịch chương (cắt trang → xoá chữ + OCR → dịch theo
 * lô, chạy nối một mạch; menu ⋯ "Chỉ xoá chữ + OCR" dừng ở Chờ dịch để soát trước) → (đang chạy: Xuất khoá) → Xuất.
 * Tiến độ nằm ở chip trạng thái (status.ts chapterChip), nút chính chỉ là bước tiếp theo.
 * Thuần: nhận trạng thái chương, upload phía client và số trang; không gọi API.
 */
import type { ChapterStatus } from "../series/api.ts";
import type { UploadView } from "./next-action.ts";

export type ChapterCommand =
  | "upload"
  | "commit"
  | "prepare_only"
  | "translate"
  | "retry"
  | "retranslate"
  | "cancel"
  | "export";

export type PrimaryAction = {
  command: ChapterCommand;
  label: string;
  disabled: boolean;
  title?: string;
  menu: { command: ChapterCommand; label: string }[];
};

const TRANSLATE_LABEL = "Dịch chương";

/** Chương nháp: `commit` gửi đích "đã dịch"; `prepare_only` gửi đích "chờ dịch". */
const TRANSLATE_DRAFT: PrimaryAction = {
  command: "commit",
  label: TRANSLATE_LABEL,
  disabled: false,
  title: "Ghép & cắt trang, xoá chữ, OCR rồi dịch + chèn chữ (dùng AI)",
  menu: [{ command: "prepare_only", label: "Chỉ xoá chữ + OCR (soát trước)" }],
};

/** Mọi ảnh đều bị bỏ qua: không còn gì để ghép — khôi phục ảnh ở rail trước. */
const ALL_SKIPPED: PrimaryAction = {
  ...TRANSLATE_DRAFT,
  disabled: true,
  title: "Đã bỏ hết ảnh — khôi phục ít nhất 1 ảnh",
  menu: [],
};

export function primaryAction(input: {
  status: ChapterStatus;
  /** Số ảnh nguồn sẽ đem cắt trang (đã khai báo, không bị bỏ qua). */
  sourceFiles: number;
  /** Số ảnh nguồn bị bỏ qua (xoá tay / credit tự bỏ). */
  skippedFiles: number;
  /** Ảnh không bị bỏ qua mà chưa lên storage (tải lỗi / tab cũ đóng giữa chừng). Xoá hết chúng → dịch được. */
  pendingFiles: number;
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
        ...TRANSLATE_DRAFT,
        disabled: true,
        title: `Chờ tải xong ảnh (${upload.done}/${upload.total})`,
        menu: [],
      };
    }
    if ((upload?.phase === "failed" || upload?.phase === "incomplete") && input.pendingFiles > 0) {
      return { command: "upload", label: "Tải ảnh", disabled: false, menu: [] };
    }
    if (input.sourceFiles === 0) {
      return input.skippedFiles > 0 ? ALL_SKIPPED : { command: "upload", label: "Tải ảnh", disabled: false, menu: [] };
    }
    return TRANSLATE_DRAFT;
  }
  if (status === "prepared") {
    return {
      command: "translate",
      label: TRANSLATE_LABEL,
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
      title: status === "ingesting" ? "Đang cắt trang — dịch xong mới xuất được" : "Dịch xong mới xuất được",
      menu: [{ command: "cancel", label: "Huỷ xử lý" }],
    };
  }
  if (status === "partial_failed") {
    // Lỗi lúc cắt trang (chưa có page): "Chạy lại trang lỗi" không có gì để chạy — commit lại = cắt lại từ ảnh đã
    // tải rồi dịch tiếp (API chỉ cho commit lại chương cắt trang lỗi).
    if (input.pages === 0) {
      if (input.sourceFiles > 0) {
        return {
          command: "commit",
          label: "Cắt lại trang",
          disabled: false,
          title: "Cắt trang lỗi — cắt lại từ ảnh đã tải rồi dịch tiếp",
          menu: [],
        };
      }
      return input.skippedFiles > 0
        ? { ...ALL_SKIPPED, label: "Cắt lại trang" }
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
