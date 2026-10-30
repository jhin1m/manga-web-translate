/**
 * Ô số của panel kiểu chữ: chuỗi đang gõ dở ("", "2" khi min 6, "1.") không được kẹp ngay — kẹp từng phím làm gõ "24"
 * thành "64" (gõ "2" → kẹp 6, rồi thêm "4"). Đang gõ chỉ áp số hợp lệ nằm trong khoảng; rời ô / Enter mới kẹp.
 */

/**
 * Chuỗi đang gõ → số áp ngay, hoặc null (rỗng, sai, ngoài khoảng — chờ gõ tiếp). `skipMin`: đúng giá trị `min` chưa áp
 * khi đang gõ (chỉ áp lúc rời ô) — vd viền 0 là xoá viền, gõ "0.5" không được xoá viền ở phím "0" rồi mất màu cũ.
 */
export function liveNumber(text: string, min: number, max: number, skipMin = false): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return skipMin && n === min ? null : n;
}

/** Rời ô: số kẹp trong khoảng; rỗng / sai → null (giữ giá trị cũ). */
export function committedNumber(text: string, min: number, max: number): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}
