/**
 * Rail ảnh gốc (chương chưa có page): mục theo thứ tự upload, nhãn trạng thái tải / bỏ qua, đếm và bước ←/→.
 * Thuần, không gọi API.
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
};

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
  return [...files]
    .sort((a, b) => a.ord - b.ord)
    .map((f, i) => ({
      id: f.id,
      ord: f.ord,
      n: i + 1,
      url: localUrls.get(f.id) ?? f.url,
      skip: f.skip,
      upload: uploads?.[f.id] ?? (uploaded && !uploaded.has(f.id) ? "missing" : null),
    }));
}

/** Nhãn dưới "Ảnh n": bỏ qua ưu tiên hơn trạng thái tải; tải xong / không tải trong tab này → không nhãn. */
export function sourceLabel(it: SourceItem): { label: string; tone: "busy" | "warn" | "danger" | "muted" } | null {
  if (it.skip) return { label: SKIP_LABEL[it.skip], tone: "muted" };
  return (it.upload && UPLOAD_LABEL[it.upload]) ?? null;
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
