/**
 * Hình học của strip cả chương: page xếp dọc liền nhau theo `ord` (toạ độ strip = toạ độ page + offset của page).
 * Thuần, không phụ thuộc React/Konva — canvas, rail và phiên sửa cùng dùng.
 */
import type { View } from "./store.ts";

/** Lề quanh strip khi kẹp khung nhìn (px màn hình). */
export const EDGE = 40;
/** Trần số page mount TileLayer cùng lúc (bộ nhớ bitmap). */
export const MAX_MOUNTED = 4;

export type Size = { w: number; h: number };
type Range = { y: number; h: number };

/** Offset dọc của từng page (cộng dồn chiều cao). */
export function pageOffsets(heights: number[]): number[] {
  const out: number[] = [];
  let y = 0;
  for (const h of heights) {
    out.push(y);
    y += h;
  }
  return out;
}

/** Kích thước strip: rộng = page rộng nhất, cao = tổng chiều cao. */
export function stripSize(pages: Size[]): Size {
  let w = 0;
  let h = 0;
  for (const p of pages) {
    w = Math.max(w, p.w);
    h += p.h;
  }
  return { w, h };
}

/** Chỉ số page chứa toạ độ strip `y` (ngoài strip → page đầu/cuối); không có page → -1. */
export function pageAt(y: number, offsets: number[]): number {
  if (offsets.length === 0) return -1;
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((offsets[mid] as number) <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Page cần mount cho vùng nhìn `viewport` (toạ độ strip), nới thêm `overscan` × chiều cao vùng nhìn mỗi phía.
 * Không bao giờ quá `max` page: giữ các page gần tâm vùng nhìn nhất. Trả theo thứ tự ord.
 */
export function visiblePages(
  offsets: number[],
  heights: number[],
  viewport: Range,
  overscan = 1,
  max = MAX_MOUNTED,
): number[] {
  const top = viewport.y - viewport.h * overscan;
  const bottom = viewport.y + viewport.h * (1 + overscan);
  const hit: number[] = [];
  for (let i = 0; i < offsets.length; i++) {
    const y0 = offsets[i] as number;
    const y1 = y0 + (heights[i] ?? 0);
    if (y1 > top && y0 < bottom) hit.push(i);
  }
  if (hit.length <= max) return hit;
  const center = viewport.y + viewport.h / 2;
  const dist = (i: number) => {
    const y0 = offsets[i] as number;
    const y1 = y0 + (heights[i] ?? 0);
    return center < y0 ? y0 - center : center > y1 ? center - y1 : 0;
  };
  return hit
    .slice()
    .sort((a, b) => dist(a) - dist(b) || a - b)
    .slice(0, max)
    .sort((a, b) => a - b);
}

/** Toạ độ strip → toạ độ trong page có offset `offset`. */
export const stripToPage = (p: { x: number; y: number }, offset: number) => ({ x: p.x, y: p.y - offset });

/** Toạ độ màn hình (trong khung canvas) → toạ độ strip theo khung nhìn. */
export const screenToStrip = (p: { x: number; y: number }, v: View) => ({
  x: (p.x - v.x) / v.scale,
  y: (p.y - v.y) / v.scale,
});

/** Khoảng cách giữa cột Gốc và cột Dịch khi chia đôi (px page). */
export const SPLIT_GAP = 32;

/**
 * Vùng nội dung vẽ trên canvas (toạ độ strip). Chia đôi: cột Dịch giữ nguyên toạ độ strip (x = 0, mọi lớp sửa
 * không đổi), cột Gốc nằm bên trái tại x = −(rộng + gap).
 */
export const contentBox = (strip: Size, split: boolean): Size & { x: number } =>
  split ? { x: -(strip.w + SPLIT_GAP), w: 2 * strip.w + SPLIT_GAP, h: strip.h } : { x: 0, ...strip };

/**
 * Giữ nội dung (rộng `strip.w`, mép trái tại `x0` toạ độ strip) trong tầm: hẹp hơn khung → căn giữa ngang; không
 * cuộn quá đầu/cuối strip.
 */
export function clampView(v: View, strip: Size, box: Size, x0 = 0): View {
  const pw = strip.w * v.scale;
  const ph = strip.h * v.scale;
  const left = v.x + x0 * v.scale;
  const l = pw + 2 * EDGE <= box.w ? (box.w - pw) / 2 : Math.min(EDGE, Math.max(box.w - pw - EDGE, left));
  const y = ph + 2 * EDGE <= box.h ? EDGE : Math.min(EDGE, Math.max(box.h - ph - EDGE, v.y));
  return { scale: v.scale, x: l - x0 * v.scale, y };
}

/** Khung nhìn đưa đỉnh page (offset) lên gần mép trên khung, giữ scale. */
export const viewAtOffset = (v: View, offset: number): View => ({ ...v, y: EDGE - offset * v.scale });
