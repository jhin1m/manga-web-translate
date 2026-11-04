import { AdminLayout } from "../features/admin/admin-layout.tsx";
import type { AdminSection } from "../features/admin/admin-sections.ts";

/** Cài đặt hệ thống (admin): `?section=` chọn mục. */
export function SettingsPage({ section }: { section: AdminSection }) {
  return <AdminLayout section={section} />;
}
