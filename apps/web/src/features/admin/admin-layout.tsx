/**
 * Trang Cài đặt: cột trái (tiêu đề trang + thanh mục theo nhóm Chung / AI / Hệ thống, mỗi mục có icon; dính khi cuộn)
 * + 1 panel phải theo `?section=`. Cả khung canh giữa theo `.page` như các trang khác.
 * Mọi người dùng đăng nhập vào được; người không phải admin chỉ thấy mục Font (`visibleSections`).
 */
import { Link } from "@tanstack/react-router";
import { PlugIcon, TypeIcon, UsersIcon, WorkflowIcon } from "../../app/settings-icons.tsx";
import { FontLibrary } from "../fonts/font-settings.tsx";
import { PipelineSection } from "../pipeline/pipeline-settings.tsx";
import { groupedSections, type SettingsSection, type SettingsSectionDef } from "./admin-sections.ts";
import { ProvidersSection } from "./providers-section.tsx";
import { UsersSection } from "./users-section.tsx";
import "./admin.css";

const PANELS: Record<SettingsSection, () => React.JSX.Element> = {
  fonts: FontLibrary,
  pipeline: PipelineSection,
  providers: ProvidersSection,
  users: UsersSection,
};

const ICONS: Record<SettingsSection, () => React.JSX.Element> = {
  fonts: TypeIcon,
  pipeline: WorkflowIcon,
  providers: PlugIcon,
  users: UsersIcon,
};

/** `sections`: mục người dùng này thấy; `section` đã nằm trong đó (route lo phần rơi về mục đầu). */
export function SettingsLayout({
  section,
  sections,
}: {
  section: SettingsSection;
  sections: readonly SettingsSectionDef[];
}) {
  const Panel = PANELS[section];
  return (
    <div className="page admin-page">
      <aside className="admin-side">
        <h1>Cài đặt</h1>
        <nav className="admin-nav" aria-label="Mục cài đặt">
          {groupedSections(sections).map((g) => (
            <div key={g.group} className="admin-nav-group">
              <span className="admin-nav-title">{g.group}</span>
              {g.sections.map((s) => {
                const Icon = ICONS[s.id];
                return (
                  <Link
                    key={s.id}
                    to="/settings"
                    search={{ section: s.id }}
                    activeOptions={{ exact: true, includeSearch: true }}
                    // Link không có `?section=` (mặc định) cũng phải sáng mục đang chọn.
                    aria-current={s.id === section ? "page" : undefined}
                  >
                    <Icon />
                    {s.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <section className="admin-panel">
        <Panel />
      </section>
    </div>
  );
}
