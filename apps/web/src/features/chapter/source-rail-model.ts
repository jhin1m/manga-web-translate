/**
 * Rail ảnh gốc (chương chưa có page): mục theo thứ tự upload, nhãn trạng thái tải / bỏ qua / gợi ý credit, đếm và
 * bước ←/→. Thuần, không gọi API.
 */
import type { SourceSkipReason } from "@mtl/shared";
import type { ItemStatus } from "../upload/upload-queue.ts";
import type { SourceFileImage } from "./api.ts";

/** "missing" = chưa lên storage (tab cũ đóng giữa chừng / file lỗi) — cần tải tiếp hoặc xoá trước Bước 1. */
export type SourceUpload = ItemStatus | "missing";

export type SourceItem = {
  id: string;
  ord: number;
  /** Số hiển thị "Ảnh n" = vị trí trong rail (ord có thể thủng sau khi commit loại file hỏng). */
  n: number;
  /** Blob local khi file được thả trong tab này (hiện ngay, không chờ tải lên), không thì URL ký. */
  url: string;
  skip: SourceSkipReason | null;
  /** Trạng thái tải; null = không có upload nào được biết (coi như đã lên storage). */
  upload: SourceUpload | null;
  /** Ảnh đầu/cuối lệch khổ so với chương — chỉ gợi ý, không tự bỏ. */
  maybeCredit: boolean;
};

/** Gợi ý credit: chỉ xét HINT_EDGE ảnh đầu + cuối, width lệch trung vị width của chương quá HINT_WIDTH_DEVIATION. */
export const HINT_EDGE = 3;
export const HINT_WIDTH_DEVIATION = 0.1;

/** Cờ "có thể là credit" theo vị trí (null = không đo được width → không gợi ý). */
export function creditHints(widths: (number | null)[]): boolean[] {
  const known = widths.filter((w): w is number => !!w).sort((a, b) => a - b);
  if (!known.length) return widths.map(() => false);
  const mid = Math.floor(known.length / 2);
  const median = known.length % 2 ? (known[mid] as number) : ((known[mid - 1] as number) + (known[mid] as number)) / 2;
  return widths.map(
    (w, i) =>
      !!w && (i < HINT_EDGE || i >= widths.length - HINT_EDGE) && Math.abs(w - median) / median > HINT_WIDTH_DEVIATION,
  );
}

export const SKIP_LABEL: Record<SourceSkipReason, string> = { user: "Đã xoá", credit: "Credit · tự bỏ" };

const UPLOAD_LABEL: Partial<Record<SourceUpload, { label: string; tone: "busy" | "warn" | "danger" }>> = {
  queued: { label: "Chờ tải", tone: "busy" },
  uploading: { label: "Đang tải", tone: "busy" },
  failed: { label: "Tải lỗi", tone: "danger" },
  missing: { label: "Chưa tải", tone: "warn" },
};

/**
 * `uploads` = trạng thái từng file của lượt tải trong tab này; `uploaded` = id đã lên storage (cả dấu tab cũ), null =
 * không biết gì → không gắn nhãn tải.
 */
export function sourceItems(
  files: SourceFileImage[],
  localUrls: Map<string, string>,
  uploads: Record<string, ItemStatus> | undefined,
  uploaded: Set<string> | null,
): SourceItem[] {
  const sorted = [...files].sort((a, b) => a.ord - b.ord);
  const hints = creditHints(sorted.map((f) => f.width));
  return sorted.map((f, i) => ({
    id: f.id,
    ord: f.ord,
    n: i + 1,
    url: localUrls.get(f.id) ?? f.url,
    skip: f.skip,
    upload: uploads?.[f.id] ?? (uploaded && !uploaded.has(f.id) ? "missing" : null),
    maybeCredit: hints[i] ?? false,
  }));
}

/**
 * Nhãn dưới "Ảnh n": bỏ qua > trạng thái tải > gợi ý credit; tải xong / không tải trong tab này và không lệch khổ →
 * không nhãn.
 */
export function sourceLabel(it: SourceItem): { label: string; tone: "busy" | "warn" | "danger" | "muted" } | null {
  if (it.skip) return { label: SKIP_LABEL[it.skip], tone: "muted" };
  const upload = it.upload && UPLOAD_LABEL[it.upload];
  if (upload) return upload;
  return it.maybeCredit ? { label: "Có thể là credit", tone: "warn" } : null;
}

export const sourceCounts = (items: SourceItem[]) => {
  const skipped = items.filter((it) => it.skip !== null).length;
  return { total: items.length, skipped, active: items.length - skipped };
};

/** Ảnh kế bên theo thứ tự rail (gồm cả ảnh bỏ qua — vẫn xem được để khôi phục). */
export function stepSource(items: SourceItem[], currentId: string | null, dir: -1 | 1): string | undefined {
  const i = items.findIndex((it) => it.id === currentId);
  return items[i < 0 ? 0 : i + dir]?.id;
}
