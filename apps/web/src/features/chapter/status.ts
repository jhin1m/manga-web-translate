/** Nhãn + tông màu trạng thái chương/page (CSS .status[data-tone]). */
import type { ChapterStatus } from "../series/api.ts";
import type { ChapterQueue, ChapterRun } from "./api.ts";
import type { UploadView } from "./next-action.ts";

export type Tone = "ok" | "busy" | "warn" | "danger" | "idle";
/** Chip trạng thái chương; `title` = giải thích thêm khi rê chuột (nguyên nhân lỗi, vì sao đang chờ). */
export type Chip = { label: string; tone: Tone; title?: string };

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

const WAITING_TITLE = "Mỗi worker làm một chương một lúc. Chương này tự bắt đầu khi có worker rảnh — không cần bấm gì.";
const NO_WORKER_TITLE =
  "Chưa thấy worker nào chạy. Lần đầu worker tải model mất vài phút; xem: docker compose logs -f worker";

/** Chip của chương đang chờ worker; giữ số trang đã xong khi chương bị chờ giữa chừng. */
function queueChip(input: ChipInput, queue: ChapterQueue): Chip {
  if (queue.state === "no_worker") return { label: "Đang chờ worker", tone: "warn", title: NO_WORKER_TITLE };
  const parts = ["Đang chờ lượt"];
  if (queue.running_chapters > 0) parts.push(`${queue.running_chapters} chương đang chạy`);
  if (input.status === "processing") {
    const view = processingView(input);
    if (view.fraction) parts.push(view.label);
  }
  return { label: parts.join(" · "), tone: "idle", title: WAITING_TITLE };
}

/** Nhãn + tiến độ (0..1) của chương đang xử lý; xem chapterChip. */
function processingView(input: ChipInput): { label: string; fraction: number | null } {
  const { pages, run } = input;
  const ratio = (done: number, total: number) => (total > 0 ? Math.min(1, Math.max(0, done / total)) : null);
  const prep = {
    label: `Xoá chữ + OCR ${pages - input.preparing}/${pages}`,
    fraction: ratio(pages - input.preparing, pages),
  };
  // Lượt "Chỉ xoá chữ + OCR" không dịch gì.
  if (run?.target === "prepared") return prep;
  // Lô dịch đầu chạy khi trang sau còn xoá chữ → nói về lượt dịch; chưa có lô nào → còn đang xoá chữ.
  if (run && (run.batch > 0 || input.preparing === 0)) {
    const lot = run.batches > 1 ? ` · lô ${run.batch}/${run.batches}` : "";
    const done = run.total - run.remaining;
    return { label: `Đang dịch · ${done}/${run.total} trang${lot}`, fraction: ratio(done, run.total) };
  }
  if (input.preparing > 0) return prep;
  return {
    label: pages ? `Đang dịch ${input.ready}/${pages}` : "Đang dịch",
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
  const parts = [extra.exports > 0 && "đang xuất", extra.uploads > 0 && "chương khác đang tải ảnh"].filter(Boolean);
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
  const review = input.review ? ` · ${input.review} cần xem` : "";
  switch (status) {
    case "draft":
      if (upload?.phase === "uploading") return { label: `Đang tải ảnh ${upload.done}/${upload.total}`, tone: "busy" };
      if (upload?.phase === "failed" || upload?.phase === "incomplete")
        return { label: `Tải dở ${upload.done}/${upload.total} ảnh`, tone: "warn" };
      return { label: "Nháp", tone: "idle" };
    case "ingesting":
      if (input.queue) return queueChip(input, input.queue);
      return { label: "Đang cắt trang", tone: "busy" };
    case "processing":
      if (input.queue) return queueChip(input, input.queue);
      return { label: processingView(input).label, tone: "busy" };
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
