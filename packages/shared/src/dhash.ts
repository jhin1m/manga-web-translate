/**
 * dHash ảnh (64 bit, 16 hex) để nhận lại ảnh credit đã học của series: trình duyệt thu ảnh về 9×8 xám rồi gọi
 * `dhashFromGray`; API so bằng `sameImage` (Hamming + tỉ lệ khung). Thuần, dùng chung web + api.
 */

export const DHASH_W = 9;
export const DHASH_H = 8;
/** Tối đa bit khác nhau để coi là cùng ảnh (ảnh nén lại / đổi kích thước vẫn khớp). */
export const DHASH_MAX_DISTANCE = 6;
/** Lệch tỉ lệ khung (w/h) tối đa, tương đối — chặn ảnh khác khổ có hash tình cờ gần. */
export const ASPECT_TOLERANCE = 0.05;
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
