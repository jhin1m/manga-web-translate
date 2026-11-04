/** Người dùng (admin): phần thuần — hàng danh sách, ai được khoá / mở, nhãn trạng thái, câu xác nhận. */

/** Hàng của `GET /api/admin/users`. */
export type AdminUser = {
  id: string;
  email: string;
  name: string;
  created_at: string;
  disabled_at: string | null;
  is_admin: boolean;
  cost_today_usd: number;
  cost_30d_usd: number;
};

/** Hành động trên hàng: admin (kể cả chính mình) không khoá được; tài khoản đang khoá luôn mở lại được. */
export function rowAction(u: Pick<AdminUser, "is_admin" | "disabled_at">): "disable" | "enable" | null {
  if (u.disabled_at) return "enable";
  return u.is_admin ? null : "disable";
}

export const statusLabel = (u: Pick<AdminUser, "is_admin" | "disabled_at">): string =>
  u.disabled_at ? "Đã khoá" : u.is_admin ? "Admin" : "Hoạt động";

export const disableConfirmText = (u: Pick<AdminUser, "email">): string =>
  `Khoá ${u.email}? Họ bị đăng xuất ngay, không đăng nhập lại được và job đang chờ của họ không chạy cho tới khi mở khoá.`;

/** Ngày tạo theo giờ máy (d/m/yyyy, định dạng vi-VN). */
export const dateText = (iso: string): string => new Date(iso).toLocaleDateString("vi-VN");
