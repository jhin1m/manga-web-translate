/** Nhãn + tông màu trạng thái chương/page (CSS .status[data-tone]). */
import { type MessageKey, t, tp } from "../../i18n/t.ts";
import type { ChapterStatus } from "../series/api.ts";
import type { ChapterQueue, ChapterRun } from "./api.ts";
import type { UploadView } from "./next-action.ts";

export type Tone = "ok" | "busy" | "warn" | "danger" | "idle";
/** Chip trạng thái chương; `title` = giải thích thêm khi rê chuột (nguyên nhân lỗi, vì sao đang chờ). */
export type Chip = { label: string; tone: Tone; title?: string };

/** `label` là getter: đọc ngôn ngữ lúc dùng, không lúc import. */
const statusEntry = (key: MessageKey, tone: Tone) => ({
  get label() {
    return t(key);
  },
  tone,
});

export const CHAPTER_STATUS: Record<ChapterStatus, { label: string; tone: Tone }> = {
  draft: statusEntry("chapter.status.draftUncommitted", "idle"),
  ingesting: statusEntry("chapter.status.ingesting", "busy"),
  processing: statusEntry("chapter.status.processing", "busy"),
  prepared: statusEntry("chapter.status.prepared", "idle"),
  review: statusEntry("chapter.status.review", "ok"),
  partial_failed: statusEntry("chapter.status.partialFailed", "danger"),
  done: statusEntry("chapter.status.done", "ok"),
};

export type PageStatus = "pending" | "preparing" | "prepared" | "translating" | "ready" | "failed";

/** Trạng thái không còn thay đổi nếu không có thao tác người dùng → dừng polling. */
export const isChapterSettled = (s: ChapterStatus | undefined) =>
  s === "draft" || s === "prepared" || s === "review" || s === "partial_failed" || s === "done";

type ChipInput = {
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
  /** Chương bận đang xếp hàng chờ worker (progress `chapter.queue`). */
  queue?: ChapterQueue | null;
};

/** Chip của chương đang chờ worker; giữ số trang đã xong khi chương bị chờ giữa chừng. */
function queueChip(input: ChipInput, queue: ChapterQueue): Chip {
  if (queue.state === "no_worker")
    return { label: t("chapter.status.waitingWorker"), tone: "warn", title: t("chapter.status.noWorkerTitle") };
  const parts = [t("chapter.status.waitingTurn")];
  if (queue.running_chapters > 0) parts.push(tp("chapter.status.runningChapters", queue.running_chapters));
  if (input.status === "processing") {
    const view = processingView(input);
    if (view.fraction) parts.push(view.label);
  }
  return { label: parts.join(" · "), tone: "idle", title: t("chapter.status.waitingTitle") };
}

/** Nhãn + tiến độ (0..1) của chương đang xử lý; xem chapterChip. */
function processingView(input: ChipInput): { label: string; fraction: number | null } {
  const { pages, run } = input;
  const ratio = (done: number, total: number) => (total > 0 ? Math.min(1, Math.max(0, done / total)) : null);
  const prep = {
    label: t("chapter.status.prepareProgress", { done: pages - input.preparing, total: pages }),
    fraction: ratio(pages - input.preparing, pages),
  };
  // Lượt "Chỉ xoá chữ + OCR" không dịch gì.
  if (run?.target === "prepared") return prep;
  // Lô dịch đầu chạy khi trang sau còn xoá chữ → nói về lượt dịch; chưa có lô nào → còn đang xoá chữ.
  if (run && (run.batch > 0 || input.preparing === 0)) {
    const done = run.total - run.remaining;
    const label =
      run.batches > 1
        ? t("chapter.status.translatingRunBatch", { done, total: run.total, batch: run.batch, batches: run.batches })
        : t("chapter.status.translatingRun", { done, total: run.total });
    return { label, fraction: ratio(done, run.total) };
  }
  if (input.preparing > 0) return prep;
  return {
    label: pages
      ? t("chapter.status.translatingCount", { done: input.ready, total: pages })
      : t("chapter.status.translating"),
    fraction: ratio(input.ready, pages),
  };
}

/**
 * Tiến độ 0..1 cho thanh 2px dưới thanh trên: `null` = đang chạy nhưng chưa đo được (vạch chạy qua lại),
 * `undefined` = không có gì đang chạy ở chương này (không vẽ thanh).
 */
export function chapterProgress(input: ChipInput): number | null | undefined {
  const { status, upload } = input;
  // Đang chờ worker: không vẽ thanh (thanh chạy qua lại trông như đang làm).
  if ((status === "ingesting" || status === "processing") && input.queue) return undefined;
  if (status === "ingesting") return null;
  if (status === "processing") return processingView(input).fraction;
  if (status === "draft" && upload?.phase === "uploading") return upload.total > 0 ? upload.done / upload.total : null;
  return undefined;
}

/**
 * Chip phản ánh cả việc ngoài chương: lượt xuất của chương này và upload của chương khác trong tab (chương này
 * đang tải ảnh thì chip đã nói rồi). Chương yên thì chip chuyển sang "đang chạy".
 */
export function chipWithActivity(chip: Chip, extra: { exports: number; uploads: number }): Chip {
  const parts = [
    extra.exports > 0 && t("chapter.status.exporting"),
    extra.uploads > 0 && t("chapter.status.otherUploading"),
  ].filter(Boolean);
  if (!parts.length) return chip;
  return {
    ...chip,
    label: [chip.label, ...parts].join(" · "),
    tone: chip.tone === "idle" || chip.tone === "ok" ? "busy" : chip.tone,
  };
}

/**
 * Trang cần xem kế tiếp sau trang đang mở (vòng lại từ đầu, bỏ qua chính trang đang mở); null khi không còn
 * trang nào khác cần xem. `ids` theo thứ tự trang.
 */
export function nextReviewPage(
  ids: readonly string[],
  activeId: string | null | undefined,
  needsReview: (id: string) => boolean,
): string | null {
  const n = ids.length;
  const start = activeId ? ids.indexOf(activeId) : -1;
  for (let i = 1; i <= n; i++) {
    const id = ids[(start + i + n) % n];
    if (id !== undefined && id !== activeId && needsReview(id)) return id;
  }
  return null;
}

/**
 * Chip trạng thái ở thanh trên màn chương — chỗ duy nhất nói chương đang ở đâu ("Đang dịch · 4/33 trang · lô 2/9",
 * "Chờ duyệt · 2 cần xem", "Xong"); rail chỉ giữ trạng thái theo trang. Thuần.
 */
export function chapterChip(input: ChipInput): Chip {
  const { status, pages, upload } = input;
  const review = !!input.review;
  const withReview = (label: string) =>
    review ? `${label} · ${t("chapter.status.needsReviewCount", { count: input.review })}` : label;
  switch (status) {
    case "draft":
      if (upload?.phase === "uploading")
        return { label: t("chapter.status.uploading", { done: upload.done, total: upload.total }), tone: "busy" };
      if (upload?.phase === "failed" || upload?.phase === "incomplete")
        return {
          label: t("chapter.status.uploadIncomplete", { done: upload.done, total: upload.total }),
          tone: "warn",
        };
      return { label: t("chapter.status.draft"), tone: "idle" };
    case "ingesting":
      if (input.queue) return queueChip(input, input.queue);
      return { label: t("chapter.status.ingesting"), tone: "busy" };
    case "processing":
      if (input.queue) return queueChip(input, input.queue);
      return { label: processingView(input).label, tone: "busy" };
    case "prepared":
      return {
        label: input.failed
          ? `${t("chapter.status.prepared")} · ${tp("chapter.status.preparedFailed", input.failed)}`
          : t("chapter.status.prepared"),
        tone: input.failed ? "warn" : "idle",
      };
    case "partial_failed":
      return pages
        ? { label: withReview(tp("chapter.status.failedPages", input.failed)), tone: "danger" }
        : { label: t("chapter.status.ingestFailed"), tone: "danger" };
    case "review":
      return { label: withReview(t("chapter.status.review")), tone: review ? "warn" : "ok" };
    case "done":
      return { label: withReview(t("chapter.status.done")), tone: review ? "warn" : "ok" };
  }
}
