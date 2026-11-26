/**
 * Trang Cài đặt: cột trái (tiêu đề trang + thanh mục theo nhóm Chung / AI / Hệ thống, mỗi mục có icon; dính khi cuộn)
 * + 1 panel phải theo `?section=`. Cả khung canh giữa theo `.page` như các trang khác.
 * Mọi người dùng đăng nhập vào được; người không phải admin chỉ thấy mục Font (`visibleSections`). Ô chọn ngôn ngữ giao
 * diện nằm dưới thanh mục (không phải một mục riêng) nên ai cũng thấy ở mục nào cũng đổi được.
 */
import { Link } from "@tanstack/react-router";
import { PlugIcon, TypeIcon, UsersIcon, WorkflowIcon } from "../../app/settings-icons.tsx";
import { useT } from "../../i18n/t.ts";
import { FontLibrary } from "../fonts/font-settings.tsx";
import { PipelineSection } from "../pipeline/pipeline-settings.tsx";
import { groupedSections, type SettingsSection, type SettingsSectionDef } from "./admin-sections.ts";
import { LanguageSettings } from "./language-settings.tsx";
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
  const { t } = useT();
  const Panel = PANELS[section];
  return (
    <div className="page admin-page">
      <aside className="admin-side">
        <h1>{t("admin.adminLayout.title")}</h1>
        <nav className="admin-nav" aria-label={t("admin.adminLayout.navAria")}>
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
        <LanguageSettings />
      </aside>
      <section className="admin-panel">
        <Panel />
      </section>
    </div>
  );
}
