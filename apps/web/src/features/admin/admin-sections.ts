/** Các mục của trang Cài đặt admin (`/settings?section=`). Thuần — test được; mục mới chỉ cần thêm vào đây. */
export const ADMIN_SECTIONS = [
  { id: "pipeline", label: "Pipeline", group: "AI" },
  { id: "providers", label: "Nhà cung cấp", group: "AI" },
  { id: "tasks", label: "Model tác vụ", group: "AI" },
  { id: "limits", label: "Hạn mức & đăng ký", group: "Hệ thống" },
  { id: "users", label: "Người dùng", group: "Hệ thống" },
  { id: "fonts", label: "Font hệ thống", group: "Hệ thống" },
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number]["id"];

const isSection = (v: unknown): v is AdminSection => ADMIN_SECTIONS.some((s) => s.id === v);

/** Giá trị lạ / thiếu → mục đầu tiên. */
export const parseSection = (v: unknown): AdminSection => (isSection(v) ? v : (ADMIN_SECTIONS[0]?.id ?? "pipeline"));

/** Chỉ giữ giá trị hợp lệ (cho `validateSearch`: URL gọn khi dùng mục mặc định). */
export const validSection = (v: unknown): AdminSection | undefined => (isSection(v) ? v : undefined);

/** Mục gom theo nhóm, giữ thứ tự khai báo; nhóm không có mục thì không xuất hiện. */
export function groupedSections(): { group: string; sections: (typeof ADMIN_SECTIONS)[number][] }[] {
  const out: { group: string; sections: (typeof ADMIN_SECTIONS)[number][] }[] = [];
  for (const s of ADMIN_SECTIONS) {
    const g = out.find((x) => x.group === s.group);
    if (g) g.sections.push(s);
    else out.push({ group: s.group, sections: [s] });
  }
  return out;
}
