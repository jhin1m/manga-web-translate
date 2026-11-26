/** Người dùng (admin): phần thuần — hàng danh sách, ai được khoá / mở, nhãn trạng thái, câu xác nhận. */
import { fmtDate } from "../../i18n/format.ts";
import { t } from "../../i18n/t.ts";

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
  t(
    u.disabled_at
      ? "admin.usersModel.status.disabled"
      : u.is_admin
        ? "admin.usersModel.status.admin"
        : "admin.usersModel.status.active",
  );

export const disableConfirmText = (u: Pick<AdminUser, "email">): string =>
  t("admin.usersModel.disableConfirm", { email: u.email });

/** Số USD chi phí trên bảng: tối đa 4 chữ số thập phân, bỏ nhiễu số thực (0.1 + 0.2 → "$0.3"). */
export const fmtUsd = (n: number) => `$${Number(n.toFixed(4))}`;

/** Ngày tạo theo giờ máy, định dạng ngắn theo ngôn ngữ giao diện (vi: d/m/yyyy). */
export const dateText = (iso: string): string => fmtDate(iso);
