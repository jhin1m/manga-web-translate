/**
 * Trạng thái chương → đúng 1 bước tiếp theo (nhãn nút + mô tả bằng lời + tông chấm). Dùng chung cho "Việc cần
 * làm" ở home và danh sách chương của series. Thuần: không gọi API, không đọc store.
 */
import type { ChapterRow } from "../series/api.ts";
import type { Tone } from "./status.ts";

/** Upload phía client của chương nháp (upload-manager; "incomplete" = tab cũ đóng giữa chừng). */
export type UploadView = {
  phase: "uploading" | "uploaded" | "failed" | "incomplete";
  done: number;
  total: number;
  /** Tự dịch khi upload xong (thả file ở home/series); undefined = không bật. */
  autoCommit?: "waiting" | "running" | "done" | "failed";
};

/** Upload xong và đang/đã tự commit — chương sắp rời nháp (chờ lần tải trạng thái kế tiếp). */
export const autoCommitStarting = (u: UploadView | null | undefined) =>
  u?.autoCommit === "running" || u?.autoCommit === "done";

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

export function nextAction(
  ch: Pick<ChapterRow, "status" | "page_counts" | "exported" | "reexport">,
  upload?: UploadView | null,
) {
  const pc = ch.page_counts ?? { total: 0, ready: 0, failed: 0, busy: 0 };
  const a = (x: Omit<NextAction, "progress"> & { progress?: number }): NextAction => ({ progress: 0, ...x });

  if (ch.status === "draft" && upload) {
    if (autoCommitStarting(upload)) {
      return a({
        kind: "progress",
        action: "Xem tiến độ",
        state: "Bắt đầu dịch",
        detail: `Đã tải ${upload.total} ảnh · đang bắt đầu dịch`,
        tone: "busy",
      });
    }
    if (upload.phase === "uploading") {
      return a({
        kind: "progress",
        action: "Xem tiến độ",
        state: "Đang tải ảnh",
        detail: `Đang tải ${upload.done}/${upload.total} ảnh${upload.autoCommit === "waiting" ? " · tự dịch khi xong" : ""}`,
        tone: "busy",
        progress: ratio(upload.done, upload.total),
      });
    }
    if (upload.phase === "failed" || upload.phase === "incomplete") {
      return a({
        kind: "resume",
        action: "Tải tiếp ảnh",
        state: "Upload dở",
        detail:
          upload.phase === "failed"
            ? `${upload.total - upload.done} ảnh tải lỗi · đã tải ${upload.done}/${upload.total}`
            : `Đã tải ${upload.done}/${upload.total} ảnh · thả lại file để tải tiếp`,
        tone: "warn",
        progress: ratio(upload.done, upload.total),
      });
    }
  }
  // Đã xuất rồi sửa tay / dịch lại: khi chương ổn định (không còn trang lỗi) → bước tiếp là xuất lại.
  if (ch.reexport && (ch.status === "review" || ch.status === "done")) {
    return a({
      kind: "reexport",
      action: "Xuất lại",
      state: "Sửa sau lần xuất",
      detail: `Có thay đổi sau lần xuất cuối · ${pc.total} trang`,
      tone: "warn",
      progress: 1,
    });
  }
  if (ch.exported && (ch.status === "review" || ch.status === "done")) {
    return a({ kind: "open", action: "Mở", state: "Đã xuất", detail: `${pc.total} trang`, tone: "ok", progress: 1 });
  }
  switch (ch.status) {
    case "draft":
      return a({
        kind: "translate",
        action: "Dịch chương",
        state: "Chưa dịch",
        detail: upload?.total ? `Đã tải ${upload.total} ảnh · chưa dịch` : "Đã tải ảnh · chưa dịch",
        tone: "idle",
      });
    case "ingesting":
      return a({
        kind: "progress",
        action: "Xem tiến độ",
        state: "Đang cắt trang",
        detail: "Đang ghép strip và cắt thành trang",
        tone: "busy",
      });
    case "processing":
      return a({
        kind: "progress",
        action: "Xem tiến độ",
        state: "Đang dịch",
        detail: `${pc.ready}/${pc.total} trang xong`,
        tone: "busy",
        progress: ratio(pc.ready, pc.total),
      });
    case "partial_failed":
      if (pc.total === 0) {
        return a({
          kind: "translate",
          action: "Dịch chương",
          state: "Cắt trang lỗi",
          detail: "Chưa cắt được trang · dịch lại từ ảnh đã tải",
          tone: "danger",
        });
      }
      return a({
        kind: "retry",
        action: "Chạy lại trang lỗi",
        state: `Lỗi ${pc.failed} trang`,
        detail: `${pc.failed} trang lỗi · ${pc.ready}/${pc.total} trang xong`,
        tone: "danger",
        progress: ratio(pc.ready, pc.total),
      });
    case "review":
      return a({
        kind: "edit",
        action: "Tiếp tục sửa",
        state: "Chờ sửa",
        detail: `AI xong ${pc.total} trang · mở để xem và sửa`,
        tone: "warn",
        progress: 1,
      });
    case "done":
      return a({ kind: "open", action: "Mở", state: "Đã xuất", detail: `${pc.total} trang`, tone: "ok", progress: 1 });
  }
}

/** Chương còn việc (bộ lọc "Cần làm"): chưa xuất, hoặc có thay đổi sau lần xuất cuối. */
export const needsWork = (ch: Pick<ChapterRow, "status" | "exported" | "reexport">) =>
  !!ch.reexport || (ch.status !== "done" && !ch.exported);
