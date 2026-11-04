/** AI › Nhà cung cấp: danh sách (key chỉ hiện ••••last4) + Kiểm tra + sửa / xoá; form thêm / sửa ngay phía trên. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api.ts";
import { PencilIcon, TrashIcon } from "../home/row-icons.tsx";
import { adminSettingsKey, type ProbeResult, probeText, providerError, providersKey, useProviders } from "./api.ts";
import { ProviderForm } from "./provider-form.tsx";
import { providerTypeLabel, type SavedProvider } from "./provider-form-model.ts";

function ProviderRow(props: { p: SavedProvider; editing: boolean; onEdit(): void }) {
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
    <>
      <tr>
        <td>{p.name}</td>
        <td className="muted">{providerTypeLabel(p)}</td>
        <td className="mono">••••{p.key_last4}</td>
        <td className="num">{p.models.length}</td>
        <td className="prov-actions">
          <button
            type="button"
            disabled={test.isPending}
            onClick={() => test.mutate()}
            aria-label={`Kiểm tra ${p.name}`}
          >
            {test.isPending ? "Đang kiểm tra…" : "Kiểm tra"}
          </button>
          <button type="button" className="icon-btn" aria-label={`Sửa ${p.name}`} title="Sửa" onClick={props.onEdit}>
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
        </td>
      </tr>
      {(shown || del.error) && (
        <tr>
          <td colSpan={5} className="prov-result">
            {shown?.data && (
              <span role="status" className={shown.data.ok ? "muted" : "error"}>
                {probeText(shown.data)}
              </span>
            )}
            {shown?.error !== undefined && (
              <span role="alert" className="error">
                {providerError(shown.error)}
              </span>
            )}
            {del.error && (
              <span role="alert" className="error">
                {providerError(del.error)}
              </span>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function ProvidersSection() {
  const q = useProviders();
  const [editing, setEditing] = useState<"new" | string | null>(null);
  if (q.error) return <p className="error">{providerError(q.error)}</p>;
  if (!q.data) return <p className="muted">Đang tải…</p>;
  const { providers, secrets_configured } = q.data;
  const editingProvider = providers.find((p) => p.id === editing);

  return (
    <div className="section-plain">
      <div className="page-head">
        <h2>Nhà cung cấp AI</h2>
        <span className="spacer" />
        {editing === null && (
          <button type="button" className="btn-primary" onClick={() => setEditing("new")}>
            Thêm nhà cung cấp
          </button>
        )}
      </div>
      <p className="muted small">
        Key được mã hoá trong DB và không bao giờ hiển thị lại. Chưa có nhà cung cấp nào được gán cho tác vụ thì worker
        dùng key trong biến môi trường của nó.
      </p>
      {!secrets_configured && (
        <p className="notice" role="alert">
          API chưa có SECRETS_KEY nên chưa lưu được key mới (xem docs/deployment-guide.md, mục biến môi trường).
        </p>
      )}
      {editing === "new" && <ProviderForm secretsConfigured={secrets_configured} onDone={() => setEditing(null)} />}
      {editingProvider && (
        <ProviderForm
          key={editingProvider.id}
          saved={editingProvider}
          secretsConfigured={secrets_configured}
          onDone={() => setEditing(null)}
        />
      )}
      {providers.length === 0 && editing !== "new" && <p className="muted">Chưa có nhà cung cấp nào.</p>}
      {providers.length > 0 && (
        <table className="data" aria-label="Danh sách nhà cung cấp">
          <thead>
            <tr>
              <th>Tên</th>
              <th>Loại</th>
              <th>Key</th>
              <th className="num">Model</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <ProviderRow key={p.id} p={p} editing={editing === p.id} onEdit={() => setEditing(p.id)} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
