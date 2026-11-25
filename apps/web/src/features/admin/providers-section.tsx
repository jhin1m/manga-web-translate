/** AI › Nhà cung cấp: danh sách thẻ (key chỉ hiện ••••last4, các model) + Kiểm tra + sửa / xoá; form sửa mở ngay trong thẻ, form thêm ở đầu danh sách. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { api } from "../../lib/api.ts";
import { PencilIcon, TrashIcon } from "../home/row-icons.tsx";
import { adminSettingsKey, type ProbeResult, probeText, providerError, providersKey, useProviders } from "./api.ts";
import { ProviderForm } from "./provider-form.tsx";
import { providerTypeLabel, type SavedProvider } from "./provider-form-model.ts";
import { SectionHead } from "./settings-ui.tsx";

function ProviderRow(props: { p: SavedProvider; editing: boolean; onEdit(): void; children?: ReactNode }) {
  const { p } = props;
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  // Kết quả gắn với bản provider lúc kiểm tra: sửa key / base URL (updated_at đổi) hoặc đang mở form sửa → bỏ kết quả cũ.
  const [probe, setProbe] = useState<{ stamp: string; data?: ProbeResult; error?: unknown } | null>(null);
  const test = useMutation({
    mutationFn: () => api<ProbeResult>(`/api/admin/providers/${p.id}/test`, { method: "POST", body: {} }),
    onMutate: () => setProbe(null),
    onSuccess: (data) => setProbe({ stamp: p.updated_at, data }),
    onError: (error) => setProbe({ stamp: p.updated_at, error }),
  });
  const shown = probe && probe.stamp === p.updated_at && !props.editing ? probe : null;
  const del = useMutation({
    mutationFn: () => api(`/api/admin/providers/${p.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: providersKey });
      void qc.invalidateQueries({ queryKey: adminSettingsKey });
    },
  });
  return (
    <li className="prov-item" aria-label={p.name}>
      <div className="prov-item-head">
        <div className="prov-item-main">
          <div>
            <strong>{p.name}</strong> <span className="prov-type">{providerTypeLabel(p)}</span>
          </div>
          <p className="set-desc">
            Key <span className="mono">••••{p.key_last4}</span> · {p.models.length} model
          </p>
          {p.models.length > 0 && (
            <ul className="prov-chips" aria-label={`Model của ${p.name}`}>
              {p.models.map((m) => (
                <li key={m.id}>
                  {m.model_id}
                  {m.vision && <span className="prov-chip-tag">vision</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="prov-actions">
          <button
            type="button"
            disabled={test.isPending}
            onClick={() => test.mutate()}
            aria-label={`Kiểm tra ${p.name}`}
          >
            {test.isPending ? "Đang kiểm tra…" : "Kiểm tra"}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Sửa ${p.name}`}
            title="Sửa"
            aria-expanded={props.editing}
            onClick={props.onEdit}
          >
            <PencilIcon />
          </button>
          {confirming ? (
            <>
              <button
                type="button"
                className="btn-danger"
                disabled={del.isPending}
                aria-label={`Xác nhận xoá ${p.name}`}
                onClick={() => del.mutate()}
              >
                Xoá?
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                Huỷ
              </button>
            </>
          ) : (
            <button
              type="button"
              className="icon-btn"
              data-danger
              aria-label={`Xoá ${p.name}`}
              title="Xoá"
              onClick={() => setConfirming(true)}
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </div>
      {shown?.data && (
        <p role="status" className={`prov-result ${shown.data.ok ? "ok-text" : "error"}`}>
          {probeText(shown.data)}
        </p>
      )}
      {shown?.error !== undefined && (
        <p role="alert" className="prov-result error">
          {providerError(shown.error)}
        </p>
      )}
      {del.error && (
        <p role="alert" className="prov-result error">
          {providerError(del.error)}
        </p>
      )}
      {props.children}
    </li>
  );
}

export function ProvidersSection() {
  const q = useProviders();
  const [editing, setEditing] = useState<"new" | string | null>(null);
  if (q.error) return <p className="error">{providerError(q.error)}</p>;
  if (!q.data) return <p className="muted">Đang tải…</p>;
  const { providers, secrets_configured } = q.data;

  return (
    <div className="set-section">
      <SectionHead
        title="Nhà cung cấp AI"
        desc="Kết nối các nhà cung cấp model AI. Key được mã hoá trong DB và không bao giờ hiện lại. Chọn model cho từng bước ở mục Pipeline; bước nào chưa chọn thì worker dùng key trong .env của nó."
        aside={
          editing !== "new" && (
            <button type="button" className="btn-primary" onClick={() => setEditing("new")}>
              Thêm nhà cung cấp
            </button>
          )
        }
      />
      {!secrets_configured && (
        <p className="notice" role="alert">
          API chưa có SECRETS_KEY nên chưa lưu được key mới (xem docs/deployment-guide.md, mục biến môi trường).
        </p>
      )}
      {editing === "new" && (
        <div className="set-card prov-new">
          <ProviderForm secretsConfigured={secrets_configured} onDone={() => setEditing(null)} />
        </div>
      )}
      {providers.length === 0 && editing !== "new" && (
        <div className="set-card set-empty">
          <p className="muted">Chưa có nhà cung cấp nào.</p>
        </div>
      )}
      {providers.length > 0 && (
        <ul className="set-card prov-list" aria-label="Danh sách nhà cung cấp">
          {providers.map((p) => (
            <ProviderRow
              key={p.id}
              p={p}
              editing={editing === p.id}
              onEdit={() => setEditing(editing === p.id ? null : p.id)}
            >
              {editing === p.id && (
                <ProviderForm saved={p} secretsConfigured={secrets_configured} onDone={() => setEditing(null)} />
              )}
            </ProviderRow>
          ))}
        </ul>
      )}
    </div>
  );
}
