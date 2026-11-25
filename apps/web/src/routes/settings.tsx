import { useMe } from "../app/app-shell.tsx";
import { SettingsLayout } from "../features/admin/admin-layout.tsx";
import { parseSection, type SettingsSection, visibleSections } from "../features/admin/admin-sections.ts";
import { useLocalMode } from "../lib/api.ts";

/**
 * Cài đặt (`?section=` chọn mục). Mục lạ / thiếu / không được thấy (người thường mở mục admin, chế độ local mở mục
 * Người dùng) → mục đầu tiên người này thấy.
 */
export function SettingsPage({ section }: { section?: SettingsSection }) {
  const me = useMe();
  const sections = visibleSections({ admin: me.is_admin, localMode: useLocalMode() });
  return <SettingsLayout section={parseSection(section, sections)} sections={sections} />;
}
