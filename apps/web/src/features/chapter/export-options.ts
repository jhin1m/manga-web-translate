/**
 * Nhãn + trạng thái của drawer "Xuất chương" (thuần, không gọi API): tên định dạng/chất lượng theo lời người dùng
 * (không lộ "slice", "ZIP PNG"), dòng tóm tắt tuỳ chọn khi thu gọn, và pha của lượt xuất vừa gửi để nút chính
 * biết đang chạy / tự tải / lỗi.
 */
import { EXPORT_FILE } from "@mtl/shared";
import type { ExportFormat, ExportLayout, ExportView } from "./api.ts";

/** CBZ: Gốc = PNG nguyên bản (worker nén JPEG khi < 100). */
export type CbzQuality = "original" | "high" | "light";
export const CBZ_QUALITY: Record<CbzQuality, { label: string; value: number }> = {
  original: { label: "Gốc", value: 100 },
  high: { label: "Cao", value: 90 },
  light: { label: "Nhẹ", value: 75 },
};

export function qualityLabel(q: number): string {
  return Object.values(CBZ_QUALITY).find((c) => c.value === q)?.label ?? `chất lượng ${q}`;
}

export const FORMAT_LABEL: Record<ExportFormat, { ext: ".zip" | ".cbz"; long: string }> = {
  png_zip: { ext: `.${EXPORT_FILE.png_zip.ext}`, long: `Ảnh trong .${EXPORT_FILE.png_zip.ext} — để đăng web` },
  cbz: { ext: `.${EXPORT_FILE.cbz.ext}`, long: `.${EXPORT_FILE.cbz.ext} — đọc bằng app đọc truyện` },
};

type Counts = { sources: number; pages: number };
type Options = { format: ExportFormat; layout: ExportLayout; quality: number; includeUntranslated: boolean };

/** Manga 1 ảnh tải lên = 1 trang → hai cách chia cho cùng kết quả, không cần hỏi. */
export const showLayoutChoice = (c: Counts) => c.sources !== c.pages;

/** Mặc định (và khi không hỏi): xuất đúng số ảnh như lúc tải lên. */
export const DEFAULT_LAYOUT: ExportLayout = "original_slices";
export const LAYOUT_CHOICES: { value: ExportLayout; label: (c: Counts) => string }[] = [
  { value: "original_slices", label: (c) => `Giống lúc tải lên (${c.sources} ảnh)` },
  { value: "pages", label: (c) => `Theo trang đã cắt (${c.pages} ảnh)` },
];

/** VD "Ảnh .zip · 96 ảnh như lúc tải lên", ".cbz · 30 trang đã cắt · Cao · gồm trang chưa dịch". */
export function optionsSummary(o: Options, c: Counts): string {
  const parts = [
    o.format === "png_zip" ? `Ảnh ${FORMAT_LABEL.png_zip.ext}` : FORMAT_LABEL.cbz.ext,
    o.layout === "original_slices" ? `${c.sources} ảnh như lúc tải lên` : `${c.pages} trang đã cắt`,
  ];
  if (o.format === "cbz") parts.push(qualityLabel(o.quality));
  if (o.includeUntranslated) parts.push("gồm trang chưa dịch");
  return parts.join(" · ");
}

/** Nhãn một lượt xuất trong danh sách: ".zip · như lúc tải lên · Cao". */
export function exportLabel(x: Pick<ExportView, "format" | "layout" | "quality" | "include_untranslated">): string {
  const parts: string[] = [
    FORMAT_LABEL[x.format].ext,
    x.layout === "original_slices" ? "như lúc tải lên" : "theo trang đã cắt",
  ];
  if (x.format === "cbz") parts.push(qualityLabel(x.quality));
  if (x.include_untranslated) parts.push("gồm trang chưa dịch");
  return parts.join(" · ");
}

export type ExportPhase =
  | { kind: "idle" }
  | { kind: "running"; pct: number; paused?: true }
  | { kind: "ready"; id: string; url: string }
  | { kind: "failed"; error: string }
  | { kind: "expired" };

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
      return { kind: "failed", error: x.error ?? "Xuất không thành công." };
    case "paused_budget":
      // Hàng đợi tự chạy lại khi có ngân sách → vẫn là lượt đang chờ, không mở nút (bấm lại = thêm lượt trùng).
      return { kind: "running", pct: Math.round(Math.min(1, Math.max(0, x.progress)) * 100), paused: true };
    case "cancelled":
      return { kind: "idle" };
  }
}
