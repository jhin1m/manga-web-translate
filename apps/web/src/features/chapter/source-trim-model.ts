/**
 * Bản nháp cắt mép ảnh gốc (thuần): so với số đã lưu để biết có đổi không, đọc ô số, kẹp theo chiều cao ảnh thật.
 * Mọi số theo pixel ảnh thật (naturalHeight).
 */
import type { SourceTrim } from "@mtl/shared";
import { clampTrim } from "./source-rail-model.ts";

export type TrimEdges = { top: number; bottom: number };

export const NO_TRIM: TrimEdges = { top: 0, bottom: 0 };

/** Số px cắt đã lưu của ảnh (không cắt = 0 / 0). */
export const savedEdges = (saved: SourceTrim | null | undefined): TrimEdges =>
  saved ? { top: saved.top, bottom: saved.bottom } : NO_TRIM;

export const sameEdges = (a: TrimEdges, b: TrimEdges) => a.top === b.top && a.bottom === b.bottom;

/** Bản nháp khác số đã lưu → cần ghi (tự lưu khi đổi ảnh, nút Lưu). */
export const trimDirty = (draft: TrimEdges | null, saved: SourceTrim | null | undefined) =>
  draft !== null && !sameEdges(draft, savedEdges(saved));

/** Giá trị gửi API: cắt 0 / 0 nghĩa là bỏ cắt (null). */
export const trimPayload = (edges: TrimEdges): TrimEdges | null => (edges.top + edges.bottom > 0 ? edges : null);

/**
 * Chữ trong ô số → px: chỉ chuỗi chữ số (tối đa 9 chữ số) mới hợp lệ. Trống, dấu trừ, thập phân, "e", chữ khác → null:
 * lần gõ đó không đổi mép (ô trống là trạng thái đang gõ, không phải "0").
 */
export function parseTrimInput(text: string): number | null {
  const t = text.trim();
  return /^\d{1,9}$/.test(t) ? Number(t) : null;
}

/** Đổi một mép của `edges` sang `value`, kẹp để phần còn lại ≥ MIN_TRIM_KEEP_PX của ảnh cao `height` px. */
export const editTrim = (edges: TrimEdges, edge: "top" | "bottom", value: number, height: number): TrimEdges =>
  edge === "top" ? clampTrim(value, edges.bottom, height, "top") : clampTrim(edges.top, value, height, "bottom");
