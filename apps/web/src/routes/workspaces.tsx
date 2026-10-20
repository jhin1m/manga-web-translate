import { Link, Navigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { signOut, useWorkspace } from "../app/app-shell.tsx";
import { api, authClient, errorMessage } from "../lib/api.ts";
import { setCurrentWs, useMyWorkspaces } from "../lib/current-workspace.ts";

/** Chọn/đổi workspace hiện tại rồi về home; chỉ 1 workspace thì vào thẳng. */
export function WorkspacePickerPage() {
  const q = useMyWorkspaces();
  const list = q.data?.workspaces;
  const only = list?.length === 1 ? list[0] : undefined;
  // Home tự chọn workspace duy nhất.
  if (only) return <Navigate to="/" replace />;

  return (
    <main className="auth">
      <h1>Chọn workspace</h1>
      {q.error && <p className="error">{errorMessage(q.error)}</p>}
      {list?.length === 0 && <p className="muted">Bạn chưa thuộc workspace nào. Hãy xin link mời.</p>}
      <table className="data" style={{ marginTop: 16 }}>
        <tbody>
          {list?.map((w) => (
            <tr key={w.id}>
              <td>
                <Link to="/" onClick={() => setCurrentWs(w.id)}>
                  {w.name}
                </Link>
              </td>
              <td className="muted mono">{w.slug}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <button type="button" className="link" onClick={() => void signOut()}>
          Đăng xuất
        </button>
      </p>
    </main>
  );
}

/** Thành viên: thông tin workspace + mời thành viên (owner/admin). */
export function MembersPage() {
  const detail = useWorkspace();
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1>Thành viên</h1>
      </div>
      <p className="muted small">
        Vai trò của bạn: {detail.role} · Worker: {detail.settings.worker_mode}
      </p>
      {detail.role !== "member" ? (
        <InviteForm ws={detail.id} />
      ) : (
        <p className="muted">Chỉ owner/admin mời được thành viên.</p>
      )}
    </div>
  );
}

function InviteForm({ ws }: { ws: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    const { data, error: err } = await authClient.organization.inviteMember({ email, role, organizationId: ws });
    if (err) return setError(err.message ?? "Không mời được");
    // MVP chưa gửi mail: lấy link có token đăng ký để owner/admin tự chuyển cho người được mời.
    try {
      const { link } = await api<{ link: string }>(`/api/w/${ws}/invitations/${data?.id ?? ""}/link`);
      setMessage(`Đã mời ${email}. Gửi link này cho họ: ${link}`);
    } catch (e) {
      setError(errorMessage(e));
    }
    setEmail("");
  }

  return (
    <form onSubmit={submit} className="section">
      <h2>Mời thành viên</h2>
      <div className="grid-2">
        <div>
          <label htmlFor="invite-email">Email</label>
          <input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="invite-role">Vai trò</label>
          <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </div>
      </div>
      <p>
        <button type="submit" className="btn-primary">
          Tạo lời mời
        </button>
      </p>
      {message && (
        <p className="notice info mono" style={{ wordBreak: "break-all" }}>
          {message}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </form>
  );
}
