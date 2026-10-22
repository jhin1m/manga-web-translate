/**
 * Hình học canvas màn chương: hiện từng trang một, toạ độ canvas = toạ độ page (page đặt tại gốc). Thuần, không phụ
 * thuộc React/Konva — canvas và phiên sửa cùng dùng.
 */
import type { View } from "./store.ts";

/** Lề quanh page khi kẹp khung nhìn (px màn hình). */
export const EDGE = 40;
/** Lề khi vừa khung / đưa đầu page lên đầu khung — nhỏ hơn `EDGE` để trang tờ vừa trọn khung ở mức đọc được. */
export const FIT_EDGE = 16;

export type Size = { w: number; h: number };

/** Toạ độ màn hình (trong khung canvas) → toạ độ page theo khung nhìn. */
export const screenToPage = (p: { x: number; y: number }, v: View) => ({
  x: (p.x - v.x) / v.scale,
  y: (p.y - v.y) / v.scale,
});

/** Khoảng cách giữa cột Gốc và cột Dịch khi chia đôi (px page). */
export const SPLIT_GAP = 32;

/**
 * Vùng nội dung vẽ trên canvas (toạ độ page). Chia đôi: cột Dịch giữ nguyên toạ độ page (x = 0, mọi lớp sửa
 * không đổi), cột Gốc nằm bên trái tại x = −(rộng + gap).
 */
export const contentBox = (page: Size, split: boolean): Size & { x: number } =>
  split ? { x: -(page.w + SPLIT_GAP), w: 2 * page.w + SPLIT_GAP, h: page.h } : { x: 0, ...page };

/**
 * Giữ nội dung (rộng `content.w`, mép trái tại `x0` toạ độ page) trong tầm: hẹp hơn khung → căn giữa ngang; không
 * cuộn quá đầu/cuối page.
 */
export function clampView(v: View, content: Size, box: Size, x0 = 0): View {
  const pw = content.w * v.scale;
  const ph = content.h * v.scale;
  const left = v.x + x0 * v.scale;
  const l = pw + 2 * EDGE <= box.w ? (box.w - pw) / 2 : Math.min(EDGE, Math.max(box.w - pw - EDGE, left));
  const y = ph + 2 * EDGE <= box.h ? EDGE : Math.min(EDGE, Math.max(box.h - ph - EDGE, v.y));
  return { scale: v.scale, x: l - x0 * v.scale, y };
}

/**
 * Vị trí thanh thao tác nổi cạnh khối đang chọn (toạ độ trong khung canvas): trên khối cách `above` (mặc định `gap`;
 * lớn hơn để chừa núm xoay của Transformer); khối sát mép trên khung nhìn → đặt dưới khối cách `gap`; kẹp trong bề
 * ngang khung.
 */
export function blockBarPos(
  box: { x: number; y: number; w: number; h: number },
  v: View,
  frame: Size,
  bar: Size,
  gap = 8,
  above = gap,
): { left: number; top: number; below: boolean } {
  const left = v.x + box.x * v.scale;
  const top = v.y + box.y * v.scale;
  const up = top - above - bar.h;
  const below = up < gap;
  return {
    left: Math.max(gap, Math.min(left, frame.w - bar.w - gap)),
    top: below ? top + box.h * v.scale + gap : up,
    below,
  };
}

/** Page cao hơn `PAGE_RATIO_MAX` × rộng (webtoon cắt dải) không vừa theo chiều cao — chữ sẽ quá nhỏ để đọc. */
export const PAGE_RATIO_MAX = 2;

/** Vừa theo chiều cao không thu page dưới mức này — khung thấp thì cuộn còn hơn chữ không đọc được. */
export const FIT_HEIGHT_MIN = 0.5;

/**
 * Scale vừa khung: vừa bề ngang nội dung (`content`, gồm cả cột Gốc khi chia đôi), trọn chiều cao `page` nếu là page
 * dạng tờ (không phải dải webtoon) nhưng không dưới `FIT_HEIGHT_MIN`, không phóng quá 100%; lề `FIT_EDGE` mỗi phía.
 */
export function fitScale(content: Size, page: Size | undefined, box: Size, min = 0.1): number {
  let s = Math.min(1, (box.w - 2 * FIT_EDGE) / content.w);
  if (page && page.h > 0 && page.h <= PAGE_RATIO_MAX * page.w)
    s = Math.min(s, Math.max(FIT_HEIGHT_MIN, (box.h - 2 * FIT_EDGE) / page.h));
  return Math.max(min, s);
}

/** Khung nhìn đưa điểm `y` (toạ độ page) lên gần mép trên khung, giữ scale. */
export const viewAtY = (v: View, y: number): View => ({ ...v, y: FIT_EDGE - y * v.scale });

/**
 * Khung nhìn khi mở 1 page: vừa khung theo chính page đó (`keepScale` = giữ zoom người dùng đã chọn), đầu page sát
 * mép trên, căn giữa ngang.
 */
export function pageStartView(page: Size, split: boolean, box: Size, keepScale?: number): View {
  const c = contentBox(page, split);
  const scale = keepScale ?? fitScale(c, page, box);
  return clampView(viewAtY({ scale, x: 0, y: 0 }, 0), c, box, c.x);
}
