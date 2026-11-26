/**
 * Mã bước worker báo qua heartbeat (`job.stage`) → nhãn theo ngôn ngữ giao diện cho thumbnail trang, cột ảnh gốc,
 * drawer Hoạt động. Kèm " i/n" (+ đơn vị) khi bước có đếm (`progress_done/progress_total`). Mã lạ → "Đang xử lý":
 * không bao giờ lộ mã bước thô. Thuần.
 */
import { type MessageKey, t } from "../../i18n/t.ts";
import type { JobView } from "./api.ts";

type StageEntry = { label: string; unit?: string };

/** Nhãn đọc ngôn ngữ lúc dùng (getter), không lúc import. */
const entry = (label: MessageKey, unit?: MessageKey): StageEntry =>
  unit
    ? {
        get label() {
          return t(label);
        },
        get unit() {
          return t(unit);
        },
      }
    : {
        get label() {
          return t(label);
        },
      };

const CUT = entry("chapter.stage.chapterIngest.cut", "chapter.stage.unit.segment");

/** Bảng nhãn theo loại job → mã bước (nguồn duy nhất; docs trỏ về đây). */
export const STAGE_LABELS: Record<string, Record<string, StageEntry>> = {
  "chapter.ingest": {
    download: entry("chapter.stage.chapterIngest.download"),
    cut: CUT,
    // Worker cũ báo bước cắt trang là `detect`.
    detect: CUT,
    upload: entry("chapter.stage.chapterIngest.upload"),
  },
  "page.prepare": {
    detect: entry("chapter.stage.pagePrepare.detect"),
    inpaint: entry("chapter.stage.pagePrepare.inpaint"),
    ocr: entry("chapter.stage.pagePrepare.ocr"),
    upload: entry("chapter.stage.pagePrepare.upload"),
    reuse_partial: entry("chapter.stage.pagePrepare.reuse_partial"),
  },
  "chapter.translate": {
    translate: entry("chapter.stage.chapterTranslate.translate"),
    typeset: entry("chapter.stage.chapterTranslate.typeset"),
  },
  "chapter.export": {
    download: entry("chapter.stage.chapterExport.download"),
    render: entry("chapter.stage.chapterExport.render"),
    upload: entry("chapter.stage.chapterExport.upload"),
  },
  "page.reinpaint": {
    detect: entry("chapter.stage.pageReinpaint.detect"),
    inpaint: entry("chapter.stage.pageReinpaint.inpaint"),
  },
  "page.ocr_region": {
    ocr: entry("chapter.stage.pageOcrRegion.ocr"),
    translate: entry("chapter.stage.pageOcrRegion.translate"),
  },
  "chapter.proofread": { proofread: entry("chapter.stage.chapterProofread.proofread") },
};

type StageJob = Pick<JobView, "type" | "stage" | "progress_done" | "progress_total">;

/** null khi job chưa báo bước nào; `short` bỏ " i/n" (thumbnail 112px). */
export function stageLabel(job: StageJob | null | undefined, opts: { short?: boolean } = {}): string | null {
  if (!job?.stage) return null;
  const found = STAGE_LABELS[job.type]?.[job.stage];
  if (!found) return t("chapter.stage.unknown");
  const { progress_done: done, progress_total: total } = job;
  if (opts.short || done == null || !total) return found.label;
  const unit = found.unit;
  return `${found.label} ${done}/${total}${unit ? ` ${unit}` : ""}`;
}
