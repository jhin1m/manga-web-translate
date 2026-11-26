/**
 * Nhãn + trạng thái của menu "Xuất chương" (thuần, không gọi API): tên định dạng/chất lượng theo lời người dùng
 * (không lộ "slice", "ZIP PNG"), dòng tóm tắt tuỳ chọn khi thu gọn, và pha của lượt xuất vừa gửi để nút chính
 * biết đang chạy / tự tải / lỗi.
 */
import { EXPORT_FILE } from "@mtl/shared";
import { t, tp } from "../../i18n/t.ts";
import type { ExportFormat, ExportLayout, ExportStatus, ExportView } from "./api.ts";
import { jobErrorLabel } from "./job-error.ts";

export const EXPORT_POLL_MS = 1500;

export const isExportActive = (s: ExportStatus) => s === "queued" || s === "running";

/** Lượt xuất mới nhất còn chạy (danh sách mới trước) — menu mở lại thì theo dõi tiếp lượt này. */
export const latestActiveExport = (list: ExportView[] | undefined) =>
  list?.find((e) => isExportActive(e.status)) ?? null;

/**
 * Chu kỳ poll danh sách xuất: còn lượt chạy (theo dữ liệu đã biết) thì poll tiếp, kể cả khi lần tải vừa rồi lỗi
 * (mạng chập chờn) — dừng hẳn thì lượt xong không tự tải, không thông báo.
 */
export const exportPollInterval = (q: { data: { exports: ExportView[] } | undefined; status: string }) =>
  latestActiveExport(q.data?.exports) ? EXPORT_POLL_MS : false;

/** CBZ: Gốc = PNG nguyên bản (worker nén JPEG khi < 100). */
export type CbzQuality = "original" | "high" | "light";
export const CBZ_QUALITY: Record<CbzQuality, { label: string; value: number }> = {
  original: {
    get label() {
      return t("chapter.exportOptions.quality.original");
    },
    value: 100,
  },
  high: {
    get label() {
      return t("chapter.exportOptions.quality.high");
    },
    value: 90,
  },
  light: {
    get label() {
      return t("chapter.exportOptions.quality.light");
    },
    value: 75,
  },
};

export function qualityLabel(q: number): string {
  return (
    Object.values(CBZ_QUALITY).find((c) => c.value === q)?.label ??
    t("chapter.exportOptions.qualityFallback", { quality: q })
  );
}

export const FORMAT_LABEL: Record<ExportFormat, { ext: ".zip" | ".cbz"; long: string }> = {
  png_zip: {
    ext: `.${EXPORT_FILE.png_zip.ext}`,
    get long() {
      return t("chapter.exportOptions.format.png_zip", { ext: `.${EXPORT_FILE.png_zip.ext}` });
    },
  },
  cbz: {
    ext: `.${EXPORT_FILE.cbz.ext}`,
    get long() {
      return t("chapter.exportOptions.format.cbz", { ext: `.${EXPORT_FILE.cbz.ext}` });
    },
  },
};

type Counts = { sources: number; pages: number };
type Options = { format: ExportFormat; layout: ExportLayout; quality: number; includeUntranslated: boolean };

/** Manga 1 ảnh tải lên = 1 trang → hai cách chia cho cùng kết quả, không cần hỏi. */
export const showLayoutChoice = (c: Counts) => c.sources !== c.pages;

/** Mặc định (và khi không hỏi): xuất đúng số ảnh như lúc tải lên. */
export const DEFAULT_LAYOUT: ExportLayout = "original_slices";
export const LAYOUT_CHOICES: { value: ExportLayout; label: (c: Counts) => string }[] = [
  { value: "original_slices", label: (c) => tp("chapter.exportOptions.layout.original_slices", c.sources) },
  { value: "pages", label: (c) => tp("chapter.exportOptions.layout.pages", c.pages) },
];

/** VD "Ảnh .zip · 96 ảnh như lúc tải lên", ".cbz · 30 trang đã cắt · Cao · gồm trang chưa dịch". */
export function optionsSummary(o: Options, c: Counts): string {
  const parts = [
    o.format === "png_zip"
      ? t("chapter.exportOptions.summary.images", { ext: FORMAT_LABEL.png_zip.ext })
      : FORMAT_LABEL.cbz.ext,
    o.layout === "original_slices"
      ? tp("chapter.exportOptions.summary.asUploaded", c.sources)
      : tp("chapter.exportOptions.summary.cutPages", c.pages),
  ];
  if (o.format === "cbz") parts.push(qualityLabel(o.quality));
  if (o.includeUntranslated) parts.push(t("chapter.exportOptions.includeUntranslated"));
  return parts.join(" · ");
}

/** Nhãn một lượt xuất trong danh sách: ".zip · như lúc tải lên · Cao". */
export function exportLabel(x: Pick<ExportView, "format" | "layout" | "quality" | "include_untranslated">): string {
  const parts: string[] = [
    FORMAT_LABEL[x.format].ext,
    x.layout === "original_slices"
      ? t("chapter.exportOptions.label.asUploaded")
      : t("chapter.exportOptions.label.cutPages"),
  ];
  if (x.format === "cbz") parts.push(qualityLabel(x.quality));
  if (x.include_untranslated) parts.push(t("chapter.exportOptions.includeUntranslated"));
  return parts.join(" · ");
}

export type ExportPhase =
  | { kind: "idle" }
  | { kind: "running"; pct: number; paused?: true }
  | { kind: "ready"; id: string; url: string }
  | { kind: "failed"; error: string; detail: string | null }
  | { kind: "expired" };

/** Câu lỗi của lượt xuất cho người dùng: nguyên nhân theo `error_class`; lỗi thô (`error`) chỉ làm chi tiết. */
export const exportFailureText = (x: Pick<ExportView, "error_class" | "error">) =>
  x.error_class || x.error
    ? t("chapter.exportOptions.failedCause", { label: jobErrorLabel(x) })
    : t("chapter.exportOptions.failed");

/** Pha của lượt xuất vừa gửi (`pendingId`) theo danh sách đang poll. */
export function exportPhase(list: ExportView[], pendingId: string | null, now = Date.now()): ExportPhase {
  if (!pendingId) return { kind: "idle" };
  const x = list.find((e) => e.id === pendingId);
  // Danh sách chưa kịp tải lại sau khi gửi job.
  if (!x) return { kind: "running", pct: 0 };
  switch (x.status) {
    case "queued":
    case "running":
      return { kind: "running", pct: Math.round(Math.min(1, Math.max(0, x.progress)) * 100) };
    case "succeeded": {
      const expired = x.expires_at !== null && Date.parse(x.expires_at) < now;
      return x.download_url && !expired ? { kind: "ready", id: x.id, url: x.download_url } : { kind: "expired" };
    }
    case "failed":
      return { kind: "failed", error: exportFailureText(x), detail: x.error };
    case "paused_budget":
      // Hàng đợi tự chạy lại khi có ngân sách → vẫn là lượt đang chờ, không mở nút (bấm lại = thêm lượt trùng).
      return { kind: "running", pct: Math.round(Math.min(1, Math.max(0, x.progress)) * 100), paused: true };
    case "cancelled":
      return { kind: "idle" };
  }
}
