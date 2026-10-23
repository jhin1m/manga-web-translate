import { Link } from "@tanstack/react-router";
import { useWorkspace } from "../app/app-shell.tsx";
import { FontSettings } from "../features/fonts/font-settings.tsx";

/** Cài đặt nhóm (workspace): hiện có tab Font. */
export function WorkspaceSettingsPage() {
  const detail = useWorkspace();
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1>Cài đặt nhóm</h1>
      </div>
      <nav className="tabs" aria-label="Mục cài đặt nhóm">
        <Link to="/w/$ws/settings" params={{ ws: detail.id }} activeOptions={{ exact: true }}>
          Font
        </Link>
      </nav>
      <div className="tab-panel">
        <FontSettings ws={detail.id} canManage={detail.role !== "member"} />
      </div>
    </div>
  );
}
