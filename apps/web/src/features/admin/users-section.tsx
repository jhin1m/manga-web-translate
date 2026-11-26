/** Hệ thống › Người dùng: bảng người dùng + chi phí hôm nay / 30 ngày (UTC), icon khoá / mở tài khoản. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { UsersIcon } from "../../app/settings-icons.tsx";
import { useT } from "../../i18n/t.ts";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { SectionHead } from "./settings-ui.tsx";
import { type AdminUser, dateText, disableConfirmText, fmtUsd, rowAction, statusLabel } from "./users-model.ts";

const usersKey = ["admin", "users"] as const;

const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
const UnlockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 7.5-2" />
  </svg>
);

function UserRow({ u, onError }: { u: AdminUser; onError: (msg: string | null) => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const action = rowAction(u);
  const toggle = useMutation({
    mutationFn: (what: "disable" | "enable") => api(`/api/admin/users/${u.id}/${what}`, { method: "POST", body: {} }),
    onSuccess: () => onError(null),
    // Cũng làm mới khi lỗi: cờ khoá có thể đã ghi dù API trả 500 (xoá phiên lỗi sau đó).
    onSettled: () => qc.invalidateQueries({ queryKey: usersKey }),
    onError: (e) =>
      onError(
        e instanceof ApiError && e.body.error === "cannot_disable_admin"
          ? t("admin.usersSection.cannotDisableAdmin")
          : errorMessage(e),
      ),
  });

  const click = () => {
    if (action === "disable" && !window.confirm(disableConfirmText(u))) return;
    if (action) toggle.mutate(action);
  };

  return (
    <tr data-disabled={u.disabled_at ? "" : undefined}>
      <td>{u.email}</td>
      <td className="muted">{u.name}</td>
      <td className="muted">{dateText(u.created_at)}</td>
      <td className="num">{fmtUsd(u.cost_today_usd)}</td>
      <td className="num">{fmtUsd(u.cost_30d_usd)}</td>
      <td className={u.disabled_at ? "error" : "muted"}>{statusLabel(u)}</td>
      <td className="prov-actions">
        {action && (
          <button
            type="button"
            className="icon-btn"
            data-danger={action === "disable" ? "" : undefined}
            disabled={toggle.isPending}
            aria-label={t(action === "disable" ? "admin.usersSection.disableAria" : "admin.usersSection.enableAria", {
              email: u.email,
            })}
            title={t(action === "disable" ? "admin.usersSection.disable" : "admin.usersSection.enable")}
            onClick={click}
          >
            {action === "disable" ? <LockIcon /> : <UnlockIcon />}
          </button>
        )}
      </td>
    </tr>
  );
}

export function UsersSection() {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);
  const users = useQuery({
    queryKey: [...usersKey, query],
    queryFn: () => api<AdminUser[]>(`/api/admin/users?q=${encodeURIComponent(query)}`),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="set-section">
      <SectionHead
        title={t("admin.usersSection.title")}
        icon={<UsersIcon />}
        desc={t("admin.usersSection.desc")}
        tip={t("admin.usersSection.tip")}
        aside={
          <input
            type="search"
            aria-label={t("admin.usersSection.searchAria")}
            placeholder={t("admin.usersSection.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }
      />
      {users.error && <p className="error">{errorMessage(users.error)}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!users.data && !users.error && <p className="muted">{t("common.loading")}</p>}
      {users.data && users.data.length === 0 && <p className="muted">{t("admin.usersSection.empty")}</p>}
      {users.data && users.data.length > 0 && (
        <div className="set-card set-table-card">
          <table className="data set-table" aria-label={t("admin.usersSection.tableAria")}>
            <thead>
              <tr>
                <th>Email</th>
                <th>{t("admin.usersSection.col.name")}</th>
                <th>{t("admin.usersSection.col.created")}</th>
                <th className="num">{t("admin.usersSection.col.today")}</th>
                <th className="num">{t("admin.usersSection.col.days30")}</th>
                <th>{t("admin.usersSection.col.status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <UserRow key={u.id} u={u} onError={setError} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
