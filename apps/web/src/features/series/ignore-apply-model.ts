/** Lời nhắn của luồng "ẩn chữ khớp trong chương đã dịch" (thuần, test được). */
import { t, tp } from "../../i18n/t.ts";
import type { IgnoreApplied, IgnorePreview, IgnoreSkipReason, IgnoreUndone } from "./api.ts";

type Skipped = { number: string; reason: IgnoreSkipReason; pages?: number };

const REASON: Record<IgnoreSkipReason, (s: Skipped) => string> = {
  locked: () => t("series.ignoreApplyModel.reason.locked"),
  busy: () => t("series.ignoreApplyModel.reason.busy"),
  changed: (s) =>
    s.pages ? tp("series.ignoreApplyModel.reason.changedPages", s.pages) : t("series.ignoreApplyModel.reason.changed"),
};

const boxes = (n: number) => tp("series.ignoreApplyModel.boxes", n);
const chapters = (n: number) => tp("series.ignoreApplyModel.chapters", n);

/** "Chương 3 (đang chạy job), Chương 5 (đang mở sửa ở tab khác)" — rỗng nếu không bỏ qua chương nào. */
export const describeSkipped = (skipped: Skipped[]) =>
  skipped
    .map((s) => t("series.ignoreApplyModel.skippedChapter", { number: s.number, reason: REASON[s.reason](s) }))
    .join(", ");

export const previewSummary = (p: IgnorePreview) =>
  p.total_boxes === 0
    ? t("series.ignoreApplyModel.previewNone")
    : t("series.ignoreApplyModel.preview", { boxes: boxes(p.total_boxes), chapters: chapters(p.chapters.length) });

export const appliedSummary = (r: IgnoreApplied) =>
  r.chapters.length === 0
    ? t("series.ignoreApplyModel.appliedNone")
    : t("series.ignoreApplyModel.applied", { boxes: boxes(r.boxes), chapters: chapters(r.chapters.length) });

export const undoneSummary = (r: IgnoreUndone) =>
  r.chapters.length === 0
    ? t("series.ignoreApplyModel.undoneNone")
    : t("series.ignoreApplyModel.undone", {
        pages: tp("common.pages", r.pages),
        chapters: chapters(r.chapters.length),
      });
