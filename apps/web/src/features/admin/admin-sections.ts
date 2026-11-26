/**
 * Các mục của trang Cài đặt (`/settings?section=`). Thuần — test được; mục mới chỉ cần thêm vào đây. Nhóm "Chung" (Font
 * riêng của từng người) cho mọi người dùng; nhóm AI / Hệ thống chỉ admin (`admin: true`).
 */
import { t } from "../../i18n/t.ts";

/** Nhãn mục / tên nhóm là getter: đọc theo ngôn ngữ giao diện lúc dùng, giữ nguyên shape cho nơi đọc `.label` / `.group`. */
export const SETTINGS_SECTIONS = [
  {
    id: "fonts",
    get label() {
      return t("admin.adminSections.label.fonts");
    },
    get group() {
      return t("admin.adminSections.group.general");
    },
    admin: false,
  },
  {
    id: "pipeline",
    get label() {
      return t("admin.adminSections.label.pipeline");
    },
    get group() {
      return t("admin.adminSections.group.ai");
    },
    admin: true,
  },
  {
    id: "providers",
    get label() {
      return t("admin.adminSections.label.providers");
    },
    get group() {
      return t("admin.adminSections.group.ai");
    },
    admin: true,
  },
  {
    id: "users",
    get label() {
      return t("admin.adminSections.label.users");
    },
    get group() {
      return t("admin.adminSections.group.system");
    },
    admin: true,
  },
] as const;

export type SettingsSectionDef = (typeof SETTINGS_SECTIONS)[number];
export type SettingsSection = SettingsSectionDef["id"];

/** Mục chỉ có nghĩa khi nhiều người dùng (quản lý tài khoản) — ẩn ở chế độ local. */
const MULTI_USER_SECTIONS: readonly SettingsSection[] = ["users"];

/** Danh sách mục người dùng này thấy: người thường chỉ mục không cần admin; chế độ local bỏ mục nhiều người dùng. */
export const visibleSections = (opts: { admin: boolean; localMode: boolean }): readonly SettingsSectionDef[] =>
  SETTINGS_SECTIONS.filter((s) => (opts.admin || !s.admin) && !(opts.localMode && MULTI_USER_SECTIONS.includes(s.id)));

const isSection = (v: unknown, sections: readonly SettingsSectionDef[]): v is SettingsSection =>
  sections.some((s) => s.id === v);

/** Giá trị lạ / thiếu / không có trong `sections` (vd người thường mở mục admin) → mục đầu tiên. */
export const parseSection = (
  v: unknown,
  sections: readonly SettingsSectionDef[] = SETTINGS_SECTIONS,
): SettingsSection => (isSection(v, sections) ? v : (sections[0]?.id ?? "fonts"));

/** Chỉ giữ giá trị hợp lệ (cho `validateSearch`: URL gọn khi dùng mục mặc định). */
export const validSection = (
  v: unknown,
  sections: readonly SettingsSectionDef[] = SETTINGS_SECTIONS,
): SettingsSection | undefined => (isSection(v, sections) ? v : undefined);

/** Mục gom theo nhóm, giữ thứ tự khai báo; nhóm không có mục thì không xuất hiện. */
export function groupedSections(
  sections: readonly SettingsSectionDef[] = SETTINGS_SECTIONS,
): { group: string; sections: SettingsSectionDef[] }[] {
  const out: { group: string; sections: SettingsSectionDef[] }[] = [];
  for (const s of sections) {
    const g = out.find((x) => x.group === s.group);
    if (g) g.sections.push(s);
    else out.push({ group: s.group, sections: [s] });
  }
  return out;
}
