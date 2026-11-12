/**
 * dHash ảnh (64 bit, 16 hex) để nhận lại ảnh credit đã học của series: trình duyệt thu ảnh về 9×8 xám rồi gọi
 * `dhashFromGray`; API so bằng `sameImage` (Hamming + tỉ lệ khung). Thuần, dùng chung web + api.
 */

import { MIN_TRIM_KEEP_PX } from "./job.ts";

export const DHASH_W = 9;
export const DHASH_H = 8;
/** Tối đa bit khác nhau để coi là cùng ảnh (ảnh nén lại / đổi kích thước vẫn khớp). */
export const DHASH_MAX_DISTANCE = 6;
/** Lệch tỉ lệ khung (w/h) tối đa, tương đối — chặn ảnh khác khổ có hash tình cờ gần. */
export const ASPECT_TOLERANCE = 0.05;
/** Dải mép thấp hơn mức này (px ảnh gốc) không học / không so được: hash 9×8 từ vài hàng điểm chủ yếu là nhiễu. */
export const MIN_BAND_PX = DHASH_H;
export const DHASH_RE = /^[0-9a-f]{16}$/;

/**
 * `gray`: 9×8 điểm xám theo hàng (72 phần tử). Bit = điểm trái sáng hơn điểm phải, đọc từ trên xuống, trái sang
 * phải, bit đầu là bit cao nhất.
 */
export function dhashFromGray(gray: ArrayLike<number>): string {
  if (gray.length !== DHASH_W * DHASH_H) throw new RangeError(`cần ${DHASH_W * DHASH_H} điểm xám`);
  let hex = "";
  let nibble = 0;
  let bits = 0;
  for (let y = 0; y < DHASH_H; y++) {
    for (let x = 0; x < DHASH_W - 1; x++) {
      const i = y * DHASH_W + x;
      nibble = (nibble << 1) | ((gray[i] as number) > (gray[i + 1] as number) ? 1 : 0);
      if (++bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return hex;
}

/** Số bit khác nhau giữa 2 hash 16 hex. */
export function hamming(a: string, b: string): number {
  if (!DHASH_RE.test(a) || !DHASH_RE.test(b)) throw new RangeError("dhash phải là 16 hex");
  let n = 0;
  for (let i = 0; i < 16; i++) {
    let x = Number.parseInt(a[i] as string, 16) ^ Number.parseInt(b[i] as string, 16);
    for (; x; x &= x - 1) n++;
  }
  return n;
}

/** Số bit 1 của hash. */
export function popcount(hex: string): number {
  return hamming(hex, "0000000000000000");
}

/**
 * Hash ít thông tin (ảnh gần trơn / gradient đều: gần hết bit 0 hoặc 1) — trang trắng, khoảng trống giữa các slice
 * webtoon cũng ra hash như vậy → không dùng làm ảnh credit (dễ tự bỏ nhầm trang truyện).
 */
export const PLAIN_HASH_BITS = 8;
export const isPlainHash = (hex: string) => {
  const n = popcount(hex);
  return n <= PLAIN_HASH_BITS || n >= 64 - PLAIN_HASH_BITS;
};

export type ImageFingerprint = { dhash: string; width: number; height: number };

/** Cùng ảnh: hash gần (≤ DHASH_MAX_DISTANCE bit) và tỉ lệ khung lệch ≤ ASPECT_TOLERANCE so với `known`. */
export function sameImage(a: ImageFingerprint, known: ImageFingerprint): boolean {
  const ra = a.width / a.height;
  const rb = known.width / known.height;
  return hamming(a.dhash, known.dhash) <= DHASH_MAX_DISTANCE && Math.abs(ra - rb) / rb <= ASPECT_TOLERANCE;
}

/** Dải mép đã học: bề rộng ảnh lúc học + chiều cao dải (px ảnh gốc lúc đó). */
export type LearnedBand = { width: number; height: number };

/**
 * Cửa sổ của dải đã học trong ảnh `imgW`×`imgH` ở mép `edge`: dải co theo bề rộng ảnh (720 ↔ 800 vẫn là cùng dải nên
 * chiều cao dải co theo), `sy` = hàng đầu cửa sổ. null khi dải thấp hơn MIN_BAND_PX (hash chỉ là nhiễu) hoặc phần
 * còn lại sau khi cắt thấp hơn MIN_TRIM_KEEP_PX.
 */
export function bandWindow(
  imgW: number,
  imgH: number,
  band: LearnedBand,
  edge: "top" | "bottom",
): { sy: number; sh: number } | null {
  if (!(imgW > 0 && imgH > 0 && band.width > 0 && band.height > 0)) return null;
  const sh = Math.round((band.height * imgW) / band.width);
  if (sh < MIN_BAND_PX || imgH - sh < MIN_TRIM_KEEP_PX) return null;
  return { sy: edge === "top" ? 0 : imgH - sh, sh };
}

/** Hash của cửa sổ ảnh khớp hash dải đã học (tỉ lệ đã khớp nhờ `bandWindow` co dải theo bề rộng). */
export const sameBand = (hash: string, band: { dhash: string }): boolean =>
  hamming(hash, band.dhash) <= DHASH_MAX_DISTANCE;
