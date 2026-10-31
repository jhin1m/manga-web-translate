/**
 * Cuộn quá mép page → sang trang kế / trước. Thuần (không DOM/React): nhận từng sự kiện wheel + thời điểm, trả
 * quyết định; canvas lo việc đổi trang thật.
 *
 * Chỉ tính phần cuộn "thừa" khi khung nhìn đã ở mép theo hướng cuộn. Cộng dồn tới `FLIP_THRESHOLD` mới đổi (1 nấc
 * chuột = ~100px không đủ, 2 nấc hoặc 1 cú vuốt trackpad thì đủ). Sau khi đổi, bỏ qua sự kiện cho tới khi hết
 * `FLIP_COOLDOWN_MS` VÀ quán tính đã dứt (ngắt ≥ `FLIP_PAUSE_MS`) — vuốt trackpad không lật liền nhiều trang.
 */

/** Cuộn thừa cần cộng dồn để đổi trang (px đã chuẩn hoá). */
export const FLIP_THRESHOLD = 160;
/** Ngắt wheel dài hơn mức này = cử chỉ mới: xoá phần đã cộng dồn / coi quán tính đã hết. */
export const FLIP_PAUSE_MS = 300;
/** Khoá tối thiểu sau khi đổi trang. */
export const FLIP_COOLDOWN_MS = 600;
/** Trần tuyệt đối của khoá kể từ lần đổi — cuộn chuột liên tục không bị nuốt mãi. */
export const FLIP_LOCK_MAX_MS = 1500;

const LINE_PX = 16;

export type FlipState = {
  /** Cuộn thừa cộng dồn có dấu (>0 xuống, <0 lên). */
  acc: number;
  /** Thời điểm sự kiện wheel tính được gần nhất. */
  last: number;
  /** Trước mốc này không đổi trang (và quán tính còn chạy thì được gia hạn, tới `lockCap`). */
  lockUntil: number;
  /** Hướng lần đổi gần nhất; lúc khoá, cuộn ngược hướng này vẫn cuộn page nhưng không đổi trang. */
  lockDir: 0 | 1 | -1;
  /** Mốc khoá không thể kéo dài quá. */
  lockCap: number;
};

export type WheelInput = {
  /** ms (đơn điệu tăng). */
  t: number;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  /** Ctrl/Cmd (zoom, pinch trackpad) hoặc Shift (cuộn ngang) giữ. */
  modified: boolean;
  /** Khung nhìn đang ở mép trên / dưới page (page nằm trọn khung = cả hai). */
  atTop: boolean;
  atBottom: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  /** Đang kéo/đổi cỡ box hoặc giữ nút chuột: không bao giờ đổi trang giữa chừng. */
  busy: boolean;
  /** Chiều cao khung nhìn, đổi `deltaMode` theo trang. */
  frameH: number;
};

export const initialFlip: FlipState = { acc: 0, last: Number.NEGATIVE_INFINITY, lockUntil: 0, lockDir: 0, lockCap: 0 };

const px = (i: WheelInput) =>
  i.deltaMode === 1 ? i.deltaY * LINE_PX : i.deltaMode === 2 ? i.deltaY * i.frameH : i.deltaY;

/**
 * @returns `flip`: 1 = trang sau, −1 = trang trước, 0 = không đổi. `locked`: sự kiện này là quán tính của lần đổi
 * trước (hoặc chính lần đổi) → canvas nuốt nó, không cuộn page mới, để trang mới vào đúng đầu/cuối.
 */
export function stepFlip(s: FlipState, i: WheelInput): { state: FlipState; flip: 0 | 1 | -1; locked: boolean } {
  const dy = px(i);
  // Zoom / cuộn ngang / không cuộn dọc: không phải ý định đổi trang, không đụng trạng thái.
  if (i.modified || i.busy || dy === 0 || Math.abs(i.deltaX) > Math.abs(i.deltaY))
    return { state: s, flip: 0, locked: false };
  const dir = dy > 0 ? 1 : -1;
  const idle = i.t - s.last > FLIP_PAUSE_MS;

  if (i.t < s.lockUntil) {
    // Cuộn ngược hướng vừa đổi: người dùng chủ động quay lại → cuộn page bình thường, chưa cho đổi trang.
    if (dir !== s.lockDir) return { state: s, flip: 0, locked: false };
    // Quán tính sau lần đổi: giữ khoá chừng nào wheel còn đến liên tục, tối đa tới `lockCap`.
    return {
      state: { ...s, acc: 0, last: i.t, lockUntil: Math.min(s.lockCap, Math.max(s.lockUntil, i.t + FLIP_PAUSE_MS)) },
      flip: 0,
      locked: true,
    };
  }
  const edge = dir > 0 ? i.atBottom : i.atTop;
  const neighbour = dir > 0 ? i.hasNext : i.hasPrev;
  if (!edge || !neighbour) return { state: { ...s, acc: 0, last: i.t }, flip: 0, locked: false };

  const acc = idle || Math.sign(s.acc) !== dir ? dy : s.acc + dy;
  if (Math.abs(acc) >= FLIP_THRESHOLD)
    return {
      state: {
        acc: 0,
        last: i.t,
        lockUntil: i.t + FLIP_COOLDOWN_MS,
        lockDir: dir,
        lockCap: i.t + FLIP_LOCK_MAX_MS,
      },
      flip: dir,
      locked: true,
    };
  return { state: { ...s, acc, last: i.t }, flip: 0, locked: false };
}
