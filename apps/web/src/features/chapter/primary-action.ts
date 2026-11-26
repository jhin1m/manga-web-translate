/**
 * Nút chính (+ menu phụ) của màn chương theo trạng thái: Tải ảnh → Dịch chương (cắt trang → xoá chữ + OCR → dịch theo
 * lô, chạy nối một mạch; menu ⋯ "Chỉ xoá chữ + OCR" dừng ở Chờ dịch để soát trước) → (đang chạy: Huỷ) → Xuất.
 * Tiến độ nằm ở chip trạng thái (status.ts chapterChip), nút chính chỉ là bước tiếp theo.
 * Thuần: nhận trạng thái chương, upload phía client và số trang; không gọi API.
 */
import { t, tp } from "../../i18n/t.ts";
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
  /** `title` = tooltip giải thích mục menu (VD dịch lại không OCR lại). */
  menu: { command: ChapterCommand; label: string; title?: string }[];
};

/** Chạy lại chỉ gửi trang lỗi (`retry-failed`), trang đã xong không đụng tới. */
const retryTitle = (failed: number) =>
  failed > 0 ? tp("chapter.primaryAction.retryTitleCount", failed) : t("chapter.primaryAction.retryTitleAll");

/** Chương nháp: `commit` gửi đích "đã dịch"; `prepare_only` gửi đích "chờ dịch". */
const translateDraft = (): PrimaryAction => ({
  command: "commit",
  label: t("chapter.primaryAction.translate"),
  disabled: false,
  title: t("chapter.primaryAction.draftTitle"),
  menu: [{ command: "prepare_only", label: t("chapter.primaryAction.prepareOnly") }],
});

/** Mọi ảnh đều bị bỏ qua: không còn gì để ghép — khôi phục ảnh ở rail trước. */
const allSkipped = (): PrimaryAction => ({
  ...translateDraft(),
  disabled: true,
  title: t("chapter.primaryAction.allSkipped"),
  menu: [],
});

const uploadAction = (): PrimaryAction => ({
  command: "upload",
  label: t("chapter.primaryAction.upload"),
  disabled: false,
  menu: [],
});

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
  const retranslate = {
    command: "retranslate" as const,
    label: t("chapter.primaryAction.retranslate"),
    title: t("chapter.primaryAction.retranslateTitle"),
  };
  if (status === "draft") {
    if (upload?.phase === "uploading") {
      return {
        ...translateDraft(),
        disabled: true,
        title: t("chapter.primaryAction.waitUpload", { done: upload.done, total: upload.total }),
        menu: [],
      };
    }
    if ((upload?.phase === "failed" || upload?.phase === "incomplete") && input.pendingFiles > 0) {
      return uploadAction();
    }
    if (input.sourceFiles === 0) {
      return input.skippedFiles > 0 ? allSkipped() : uploadAction();
    }
    return translateDraft();
  }
  if (status === "prepared") {
    return {
      command: "translate",
      label: t("chapter.primaryAction.translate"),
      disabled: false,
      title: t("chapter.primaryAction.preparedTitle"),
      menu:
        input.failed > 0
          ? [{ command: "retry", label: t("chapter.primaryAction.retryFailed"), title: retryTitle(input.failed) }]
          : [],
    };
  }
  if (status === "ingesting" || status === "processing") {
    return {
      command: "cancel",
      label: t("common.cancel"),
      disabled: false,
      title: t(
        status === "ingesting" ? "chapter.primaryAction.cancelSlicing" : "chapter.primaryAction.cancelProcessing",
      ),
      menu: [],
    };
  }
  if (status === "partial_failed") {
    // Lỗi lúc cắt trang (chưa có page): "Chạy lại trang lỗi" không có gì để chạy — commit lại = cắt lại từ ảnh đã
    // tải rồi dịch tiếp (API chỉ cho commit lại chương cắt trang lỗi).
    if (input.pages === 0) {
      if (input.sourceFiles > 0) {
        return {
          command: "commit",
          label: t("chapter.primaryAction.reslice"),
          disabled: false,
          title: t("chapter.primaryAction.resliceTitle"),
          menu: [],
        };
      }
      return input.skippedFiles > 0 ? { ...allSkipped(), label: t("chapter.primaryAction.reslice") } : uploadAction();
    }
    return {
      command: "retry",
      label:
        input.failed > 0
          ? tp("chapter.primaryAction.retryCount", input.failed)
          : t("chapter.primaryAction.retryFailed"),
      disabled: false,
      title: retryTitle(input.failed),
      menu: [{ command: "export", label: t("chapter.primaryAction.export") }, retranslate],
    };
  }
  // review / done
  return {
    command: "export",
    label: t("chapter.primaryAction.export"),
    disabled: input.pages === 0,
    menu: input.pages > 0 ? [retranslate] : [],
  };
}
