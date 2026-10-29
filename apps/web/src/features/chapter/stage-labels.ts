/**
 * Mã bước worker báo qua heartbeat (`job.stage`) → nhãn tiếng Việt cho thumbnail trang, cột ảnh gốc, drawer Hoạt
 * động. Kèm " i/n" (+ đơn vị) khi bước có đếm (`progress_done/progress_total`). Mã lạ → "Đang xử lý": không bao giờ
 * lộ mã tiếng Anh. Thuần.
 */
import type { JobView } from "./api.ts";

type StageEntry = { label: string; unit?: string };

const CUT: StageEntry = { label: "Đang cắt trang", unit: "đoạn" };

/** Bảng nhãn theo loại job → mã bước (nguồn duy nhất; docs trỏ về đây). */
export const STAGE_LABELS: Record<string, Record<string, StageEntry>> = {
  "chapter.ingest": {
    download: { label: "Đang tải ảnh" },
    cut: CUT,
    // Worker cũ báo bước cắt trang là `detect`.
    detect: CUT,
    upload: { label: "Đang lưu trang" },
  },
  "page.prepare": {
    detect: { label: "Nhận diện chữ" },
    inpaint: { label: "Xoá chữ" },
    ocr: { label: "Đọc chữ (OCR)" },
    upload: { label: "Lưu ảnh" },
    reuse_partial: { label: "Dùng lại ảnh đã xoá chữ" },
  },
  "chapter.translate": {
    translate: { label: "Đang dịch" },
    typeset: { label: "Đang đặt chữ" },
  },
  "chapter.export": {
    download: { label: "Tải ảnh" },
    render: { label: "Vẽ chữ" },
    upload: { label: "Đóng gói" },
  },
  "page.reinpaint": { inpaint: { label: "Xoá chữ lại" } },
  "page.ocr_region": { ocr: { label: "Đọc chữ" }, translate: { label: "Dịch" } },
  "chapter.proofread": { proofread: { label: "Hiệu đính" } },
};

const UNKNOWN = "Đang xử lý";

type StageJob = Pick<JobView, "type" | "stage" | "progress_done" | "progress_total">;

/** null khi job chưa báo bước nào; `short` bỏ " i/n" (thumbnail 112px). */
export function stageLabel(job: StageJob | null | undefined, opts: { short?: boolean } = {}): string | null {
  if (!job?.stage) return null;
  const entry = STAGE_LABELS[job.type]?.[job.stage];
  if (!entry) return UNKNOWN;
  const { progress_done: done, progress_total: total } = job;
  if (opts.short || done == null || !total) return entry.label;
  return `${entry.label} ${done}/${total}${entry.unit ? ` ${entry.unit}` : ""}`;
}
