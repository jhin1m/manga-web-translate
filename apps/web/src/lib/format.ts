/** Định dạng hiển thị dùng chung (theo ngôn ngữ giao diện). */
import { fmtDate } from "../i18n/format.ts";
import { t, tp } from "../i18n/t.ts";

export const fmtBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** "vừa xong", "20 phút trước", "3 giờ trước", "hôm qua", "12/10" (theo ngôn ngữ giao diện). */
export function timeAgo(iso: string, now = Date.now()): string {
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  if (min < 1) return t("lib.format.justNow");
  if (min < 60) return tp("lib.format.minutesAgo", min);
  const h = Math.floor(min / 60);
  if (h < 24) return tp("lib.format.hoursAgo", h);
  if (h < 48) return t("lib.format.yesterday");
  return fmtDate(iso, { day: "2-digit", month: "2-digit" });
}
