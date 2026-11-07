/** Các mục của trang Cài đặt admin (`/settings?section=`). Thuần — test được; mục mới chỉ cần thêm vào đây. */
export const ADMIN_SECTIONS = [
  { id: "pipeline", label: "Pipeline", group: "AI" },
  { id: "providers", label: "Nhà cung cấp", group: "AI" },
  { id: "tasks", label: "Model tác vụ", group: "AI" },
  { id: "limits", label: "Hạn mức & đăng ký", group: "Hệ thống" },
  { id: "users", label: "Người dùng", group: "Hệ thống" },
  { id: "fonts", label: "Font hệ thống", group: "Hệ thống" },
] as const;

export type AdminSectionDef = (typeof ADMIN_SECTIONS)[number];
export type AdminSection = AdminSectionDef["id"];

/** Mục chỉ có nghĩa khi nhiều người dùng (đăng ký, hạn mức, quản lý tài khoản) — ẩn ở chế độ local. */
const MULTI_USER_SECTIONS: readonly AdminSection[] = ["limits", "users"];

/** Danh sách mục hiển thị theo chế độ chạy. */
export const visibleSections = (localMode: boolean): readonly AdminSectionDef[] =>
  localMode ? ADMIN_SECTIONS.filter((s) => !MULTI_USER_SECTIONS.includes(s.id)) : ADMIN_SECTIONS;

const isSection = (v: unknown, sections: readonly AdminSectionDef[]): v is AdminSection =>
  sections.some((s) => s.id === v);

/** Giá trị lạ / thiếu / không có trong `sections` → mục đầu tiên. */
export const parseSection = (v: unknown, sections: readonly AdminSectionDef[] = ADMIN_SECTIONS): AdminSection =>
  isSection(v, sections) ? v : (sections[0]?.id ?? "pipeline");

/** Chỉ giữ giá trị hợp lệ (cho `validateSearch`: URL gọn khi dùng mục mặc định). */
export const validSection = (
  v: unknown,
  sections: readonly AdminSectionDef[] = ADMIN_SECTIONS,
): AdminSection | undefined => (isSection(v, sections) ? v : undefined);

/** Mục gom theo nhóm, giữ thứ tự khai báo; nhóm không có mục thì không xuất hiện. */
export function groupedSections(
  sections: readonly AdminSectionDef[] = ADMIN_SECTIONS,
): { group: string; sections: AdminSectionDef[] }[] {
  const out: { group: string; sections: AdminSectionDef[] }[] = [];
  for (const s of sections) {
    const g = out.find((x) => x.group === s.group);
    if (g) g.sections.push(s);
    else out.push({ group: s.group, sections: [s] });
  }
  return out;
}
