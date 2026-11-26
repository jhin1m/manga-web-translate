/**
 * Trạng thái chương → đúng 1 bước tiếp theo (nhãn nút + mô tả bằng lời + tông chấm). Dùng chung cho "Việc cần
 * làm" ở home và danh sách chương của series. Thuần: không gọi API, không đọc store.
 */
import { t, tp } from "../../i18n/t.ts";
import type { ChapterRow } from "../series/api.ts";
import type { Tone } from "./status.ts";

/** Upload phía client của chương nháp (upload-manager; "incomplete" = tab cũ đóng giữa chừng). */
export type UploadView = {
  phase: "uploading" | "uploaded" | "failed" | "incomplete";
  done: number;
  total: number;
};

export type NextActionKind = "progress" | "resume" | "translate" | "retry" | "edit" | "reexport" | "open";

export type NextAction = {
  kind: NextActionKind;
  /** Nhãn nút hành động chính. */
  action: string;
  /** Trạng thái ngắn cạnh chấm màu. */
  state: string;
  /** Mô tả bằng lời (dòng phụ). */
  detail: string;
  tone: Tone;
  /** 0..1 cho thanh tiến độ. */
  progress: number;
};

const ratio = (a: number, b: number) => (b > 0 ? Math.min(1, a / b) : 0);

/** Chương đã xuất / xong: mở để xem. */
const opened = (pages: number): NextAction => ({
  kind: "open",
  action: t("chapter.nextAction.action.open"),
  state: t("chapter.nextAction.state.exported"),
  detail: tp("common.pages", pages),
  tone: "ok",
  progress: 1,
});

export function nextAction(
  ch: Pick<ChapterRow, "status" | "page_counts" | "exported" | "reexport" | "queue_state">,
  upload?: UploadView | null,
) {
  const pc = ch.page_counts ?? { total: 0, ready: 0, failed: 0, busy: 0 };
  const a = (x: Omit<NextAction, "progress"> & { progress?: number }): NextAction => ({ progress: 0, ...x });

  if (ch.status === "draft" && upload) {
    if (upload.phase === "uploading") {
      return a({
        kind: "progress",
        action: t("chapter.nextAction.action.viewProgress"),
        state: t("chapter.nextAction.state.uploading"),
        detail: t("chapter.nextAction.detail.uploading", { done: upload.done, total: upload.total }),
        tone: "busy",
        progress: ratio(upload.done, upload.total),
      });
    }
    if (upload.phase === "failed" || upload.phase === "incomplete") {
      return a({
        kind: "resume",
        action: t("chapter.nextAction.action.resumeUpload"),
        state: t("chapter.nextAction.state.uploadIncomplete"),
        detail:
          upload.phase === "failed"
            ? t("chapter.nextAction.detail.uploadFailed", {
                failed: upload.total - upload.done,
                done: upload.done,
                total: upload.total,
              })
            : t("chapter.nextAction.detail.uploadIncomplete", { done: upload.done, total: upload.total }),
        tone: "warn",
        progress: ratio(upload.done, upload.total),
      });
    }
  }
  // Đã xuất rồi sửa tay / dịch lại: khi chương ổn định (không còn trang lỗi) → bước tiếp là xuất lại.
  if (ch.reexport && (ch.status === "review" || ch.status === "done")) {
    return a({
      kind: "reexport",
      action: t("chapter.nextAction.action.reexport"),
      state: t("chapter.nextAction.state.editedAfterExport"),
      detail: tp("chapter.nextAction.detail.changedAfterExport", pc.total),
      tone: "warn",
      progress: 1,
    });
  }
  if (ch.exported && (ch.status === "review" || ch.status === "done")) return opened(pc.total);
  // Chương bận chưa có job nào chạy: nói rõ đang xếp hàng, không để giống "Đang xử lý" (người dùng tưởng treo).
  if ((ch.status === "ingesting" || ch.status === "processing") && ch.queue_state) {
    const noWorker = ch.queue_state === "no_worker";
    return a({
      kind: "progress",
      action: t("chapter.nextAction.action.viewProgress"),
      state: t(noWorker ? "chapter.nextAction.state.waitingWorker" : "chapter.nextAction.state.waitingTurn"),
      detail: noWorker
        ? t("chapter.nextAction.detail.noWorker")
        : pc.ready
          ? t("chapter.nextAction.detail.waitingProgress", { ready: pc.ready, total: pc.total })
          : t("chapter.nextAction.detail.waitingStart"),
      tone: noWorker ? "warn" : "idle",
      progress: ratio(pc.ready, pc.total),
    });
  }
  switch (ch.status) {
    case "draft":
      return a({
        kind: "translate",
        action: t("chapter.nextAction.action.translate"),
        state: t("chapter.nextAction.state.notProcessed"),
        detail: upload?.total
          ? tp("chapter.nextAction.detail.draftUploadedCount", upload.total)
          : t("chapter.nextAction.detail.draftUploaded"),
        tone: "idle",
      });
    case "ingesting":
      return a({
        kind: "progress",
        action: t("chapter.nextAction.action.viewProgress"),
        state: t("chapter.nextAction.state.slicing"),
        detail: t("chapter.nextAction.detail.slicing"),
        tone: "busy",
      });
    case "prepared":
      return a({
        kind: "translate",
        action: t("chapter.nextAction.action.translate"),
        state: t("chapter.nextAction.state.awaitingTranslation"),
        detail: pc.failed
          ? tp("chapter.nextAction.detail.preparedWithFailed", pc.total, { failed: pc.failed })
          : tp("chapter.nextAction.detail.prepared", pc.total),
        tone: "idle",
      });
    case "processing":
      return a({
        kind: "progress",
        action: t("chapter.nextAction.action.viewProgress"),
        state: t("chapter.nextAction.state.processing"),
        detail: t("chapter.nextAction.detail.processing", { ready: pc.ready, total: pc.total }),
        tone: "busy",
        progress: ratio(pc.ready, pc.total),
      });
    case "partial_failed":
      if (pc.total === 0) {
        return a({
          kind: "translate",
          action: t("chapter.nextAction.action.reslice"),
          state: t("chapter.nextAction.state.sliceFailed"),
          detail: t("chapter.nextAction.detail.sliceFailed"),
          tone: "danger",
        });
      }
      return a({
        kind: "retry",
        action: t("chapter.nextAction.action.retryFailed"),
        state: tp("chapter.nextAction.state.failedPages", pc.failed),
        detail: t("chapter.nextAction.detail.partialFailed", { failed: pc.failed, ready: pc.ready, total: pc.total }),
        tone: "danger",
        progress: ratio(pc.ready, pc.total),
      });
    case "review":
      return a({
        kind: "edit",
        action: t("chapter.nextAction.action.continueEdit"),
        state: t("chapter.nextAction.state.awaitingReview"),
        detail: tp("chapter.nextAction.detail.review", pc.total),
        tone: "warn",
        progress: 1,
      });
    case "done":
      return opened(pc.total);
  }
}

/** Chương còn việc (bộ lọc "Cần làm"): chưa xuất, hoặc có thay đổi sau lần xuất cuối. */
export const needsWork = (ch: Pick<ChapterRow, "status" | "exported" | "reexport">) =>
  !!ch.reexport || (ch.status !== "done" && !ch.exported);
