import { Link } from "@tanstack/react-router";
import { useWorkspace } from "../app/app-shell.tsx";
import { FontSettings } from "../features/fonts/font-settings.tsx";
import { PipelineSettingsForm } from "../features/pipeline/pipeline-settings.tsx";
import "../features/pipeline/pipeline.css";

/** Cài đặt nhóm (workspace): tab Font và Pipeline (`?tab=pipeline`). */
export function WorkspaceSettingsPage({ tab }: { tab: "fonts" | "pipeline" }) {
  const detail = useWorkspace();
  const canManage = detail.role !== "member";
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1>Cài đặt nhóm</h1>
      </div>
      <nav className="tabs" aria-label="Mục cài đặt nhóm">
        <Link
          to="/w/$ws/settings"
          params={{ ws: detail.id }}
          search={{}}
          activeOptions={{ exact: true, includeSearch: true }}
        >
          Font
        </Link>
        <Link
          to="/w/$ws/settings"
          params={{ ws: detail.id }}
          search={{ tab: "pipeline" }}
          activeOptions={{ exact: true, includeSearch: true }}
        >
          Pipeline
        </Link>
      </nav>
      <div className="tab-panel">
        {tab === "pipeline" ? (
          <PipelineSettingsForm ws={detail.id} value={detail.settings.pipeline} canManage={canManage} />
        ) : (
          <FontSettings ws={detail.id} canManage={canManage} />
        )}
      </div>
    </div>
  );
}
