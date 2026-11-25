/**
 * Các mục của trang Cài đặt (`/settings?section=`). Thuần — test được; mục mới chỉ cần thêm vào đây. Nhóm "Chung" (Font
 * riêng của từng người) cho mọi người dùng; nhóm AI / Hệ thống chỉ admin (`admin: true`).
 */
export const SETTINGS_SECTIONS = [
  { id: "fonts", label: "Font", group: "Chung", admin: false },
  { id: "pipeline", label: "Pipeline", group: "AI", admin: true },
  { id: "providers", label: "Nhà cung cấp", group: "AI", admin: true },
  { id: "users", label: "Người dùng", group: "Hệ thống", admin: true },
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
