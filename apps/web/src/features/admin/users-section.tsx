/** Hệ thống › Người dùng: bảng người dùng + chi phí hôm nay / 30 ngày (UTC), icon khoá / mở tài khoản. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { fmtUsd } from "./limits-model.ts";
import { type AdminUser, dateText, disableConfirmText, rowAction, statusLabel } from "./users-model.ts";

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
          ? "Không khoá được tài khoản admin."
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
            aria-label={`${action === "disable" ? "Khoá" : "Mở khoá"} ${u.email}`}
            title={action === "disable" ? "Khoá" : "Mở khoá"}
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
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const users = useQuery({
    queryKey: [...usersKey, query],
    queryFn: () => api<AdminUser[]>(`/api/admin/users?q=${encodeURIComponent(query)}`),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="section-plain">
      <div className="page-head">
        <h2>Người dùng</h2>
        <span className="spacer" />
        <input
          type="search"
          aria-label="Tìm người dùng"
          placeholder="Tìm email hoặc tên"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <p className="muted small">Chi phí tính theo ngày UTC. Tối đa 500 người, mới nhất trước.</p>
      {users.error && <p className="error">{errorMessage(users.error)}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!users.data && !users.error && <p className="muted">Đang tải…</p>}
      {users.data && users.data.length === 0 && <p className="muted">Không có người dùng nào.</p>}
      {users.data && users.data.length > 0 && (
        <table className="data" aria-label="Danh sách người dùng">
          <thead>
            <tr>
              <th>Email</th>
              <th>Tên</th>
              <th>Ngày tạo</th>
              <th className="num">Hôm nay</th>
              <th className="num">30 ngày</th>
              <th>Trạng thái</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.data.map((u) => (
              <UserRow key={u.id} u={u} onError={setError} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
