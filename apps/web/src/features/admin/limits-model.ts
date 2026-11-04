/** Hạn mức & đăng ký (admin): phần thuần của form — đọc ô USD, điều kiện bật đăng ký, câu xác nhận khi hạ hạn mức. */

export type StoredLimits = {
  user_daily_usd: number | null;
  global_daily_usd: number | null;
  signup_enabled: boolean | null;
};
export type LimitsEnv = StoredLimits;
/** Phản hồi 409 `confirm_required` của `PUT /api/admin/settings/limits`. */
export type ConfirmRequired = {
  max_user_spent_usd: number;
  global_spent_usd: number;
  user_over: boolean;
  global_over: boolean;
  user_jobs: number | null;
  global_jobs: number | null;
};

/** Ô trống = theo env (`null`); số ≥ 0 hợp lệ; còn lại (chữ, âm, vô hạn) = `"invalid"`. Chấp nhận dấu phẩy thập phân. */
export function parseUsd(text: string): number | null | "invalid" {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return "invalid";
  const n = Number(t);
  return Number.isFinite(n) ? n : "invalid";
}

/** Bật đăng ký cần đủ cả 2 hạn mức hiệu lực (giá trị đang gõ, trống thì theo env). */
export function canEnableSignup(
  userText: string,
  globalText: string,
  env: { user_daily_usd: number | null; global_daily_usd: number | null },
): boolean {
  const u = parseUsd(userText);
  const g = parseUsd(globalText);
  if (u === "invalid" || g === "invalid") return false;
  return (u ?? env.user_daily_usd) !== null && (g ?? env.global_daily_usd) !== null;
}

export const fmtUsd = (n: number) => `$${Number(n.toFixed(4))}`;

/** Số hiển thị trong ô (null → trống). */
export const usdText = (n: number | null) => (n === null ? "" : n.toFixed(10).replace(/\.?0+$/, ""));

/** Các câu cảnh báo (1 cho mỗi hạn mức bị hạ xuống dưới số đã chi hôm nay). */
export function confirmWarnings(c: ConfirmRequired, next: { user: number | null; global: number | null }): string[] {
  const out: string[] = [];
  if (c.user_over && next.user !== null) {
    out.push(
      `Hạn mức mới ${fmtUsd(next.user)} thấp hơn số người dùng đã chi hôm nay (cao nhất ${fmtUsd(c.max_user_spent_usd)}). ` +
        `Ngay khi lưu: ${c.user_jobs ?? 0} job AI đang chờ hoặc chạy của họ bị huỷ (lỗi quota_exceeded) hoặc dừng ở nhịp kế; ` +
        `nâng hạn mức lại không tự chạy lại — họ phải bấm "Chạy lại trang lỗi" (tốn tiền AI lại phần đã chạy dở). ` +
        `Đặt lại về 0h UTC.`,
    );
  }
  if (c.global_over && next.global !== null) {
    out.push(
      `Ngân sách ngày mới ${fmtUsd(next.global)} thấp hơn tổng đã chi hôm nay ${fmtUsd(c.global_spent_usd)}. ` +
        `Mọi job AI (${c.global_jobs ?? 0} đang chờ hoặc chạy) dừng ở trạng thái paused_budget và tự chạy lại khi sang ngày UTC mới hoặc khi nâng ngưỡng.`,
    );
  }
  return out;
}
