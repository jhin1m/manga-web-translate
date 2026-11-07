/**
 * Trang Cài đặt admin: thanh mục trái (nhóm AI / Hệ thống) + 1 panel phải theo `?section=`.
 * Chỉ admin (`me.is_admin`); người khác về `/`.
 */
import { Link, Navigate } from "@tanstack/react-router";
import { useMe } from "../../app/app-shell.tsx";
import { errorMessage, useLocalMode } from "../../lib/api.ts";
import { PipelineSettingsForm } from "../pipeline/pipeline-settings.tsx";
import { type AdminSection, groupedSections, visibleSections } from "./admin-sections.ts";
import { useAdminSettings } from "./api.ts";
import { LimitsSection } from "./limits-section.tsx";
import { ProvidersSection } from "./providers-section.tsx";
import { SystemFontsSection } from "./system-fonts-section.tsx";
import { TasksSection } from "./tasks-section.tsx";
import { UsersSection } from "./users-section.tsx";
import "../pipeline/pipeline.css";
import "./admin.css";

function PipelineSection() {
  const q = useAdminSettings();
  if (q.error) return <p className="error">{errorMessage(q.error)}</p>;
  if (!q.data) return <p className="muted">Đang tải…</p>;
  return <PipelineSettingsForm value={q.data.pipeline} />;
}

const PANELS: Record<AdminSection, () => React.JSX.Element> = {
  pipeline: PipelineSection,
  providers: ProvidersSection,
  tasks: TasksSection,
  limits: LimitsSection,
  users: UsersSection,
  fonts: SystemFontsSection,
};

export function AdminLayout({ section }: { section: AdminSection }) {
  const me = useMe();
  const groups = groupedSections(visibleSections(useLocalMode()));
  if (!me.is_admin) return <Navigate to="/" replace />;
  const Panel = PANELS[section];
  return (
    <div className="page admin-page">
      <div className="page-head">
        <h1>Cài đặt</h1>
      </div>
      <div className="admin-body">
        <nav className="admin-nav" aria-label="Mục cài đặt">
          {groups.map((g) => (
            <div key={g.group} className="admin-nav-group">
              <span className="admin-nav-title">{g.group}</span>
              {g.sections.map((s) => (
                <Link
                  key={s.id}
                  to="/settings"
                  search={{ section: s.id }}
                  activeOptions={{ exact: true, includeSearch: true }}
                  // Link không có `?section=` (mặc định) cũng phải sáng mục đang chọn.
                  aria-current={s.id === section ? "page" : undefined}
                >
                  {s.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <section className="admin-panel">
          <Panel />
        </section>
      </div>
    </div>
  );
}
