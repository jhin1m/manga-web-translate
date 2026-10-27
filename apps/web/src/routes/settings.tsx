import { Link } from "@tanstack/react-router";
import { useMe } from "../app/app-shell.tsx";
import { FontSettings } from "../features/fonts/font-settings.tsx";
import { PipelineSettingsForm } from "../features/pipeline/pipeline-settings.tsx";
import { usd } from "../lib/api.ts";
import "../features/pipeline/pipeline.css";

/** Cài đặt chung: tab Font và Pipeline (`?tab=pipeline`) + hạn mức chi phí hôm nay (khi có giới hạn). */
export function SettingsPage({ tab }: { tab: "fonts" | "pipeline" }) {
  const me = useMe();
  const { quota } = me;
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1>Cài đặt chung</h1>
      </div>
      {quota.limit_usd !== null && (
        <p className="muted small" data-testid="quota-line">
          Hạn mức AI hôm nay: {usd(quota.spent_usd)} / {usd(quota.limit_usd)}
        </p>
      )}
      <nav className="tabs" aria-label="Mục cài đặt chung">
        <Link to="/settings" search={{}} activeOptions={{ exact: true, includeSearch: true }}>
          Font
        </Link>
        <Link to="/settings" search={{ tab: "pipeline" }} activeOptions={{ exact: true, includeSearch: true }}>
          Pipeline
        </Link>
      </nav>
      <div className="tab-panel">
        {tab === "pipeline" ? <PipelineSettingsForm value={me.settings.pipeline} /> : <FontSettings />}
      </div>
    </div>
  );
}
