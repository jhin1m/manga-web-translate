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

/** `mail_sent`: true = đã gửi, false = gửi lỗi / chưa cấu hình, null = server không có ghi nhận (vd vừa khởi động lại). */
type LinkInfo = { link: string; mail_enabled: boolean; mail_sent: boolean | null };

function InviteForm({ ws }: { ws: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Lời mời vừa tạo, có thể gửi lại email (chỉ khi server bật mail).
  const [last, setLast] = useState<{ id: string; email: string; role: "member" | "admin" } | null>(null);
  const [resending, setResending] = useState(false);

  /** Lấy link (có token đăng ký) + kết quả gửi mail; câu thông báo đổi theo việc mail thật sự đã gửi hay chưa. */
  async function report(id: string, to: string, inviteRole: "member" | "admin", verb: string) {
    try {
      const { link, mail_enabled, mail_sent } = await api<LinkInfo>(`/api/w/${ws}/invitations/${id}/link`);
      setMessage(
        !mail_enabled
          ? `Đã mời ${to}. Gửi link này cho họ: ${link}`
          : mail_sent === true
            ? `${verb} email mời tới ${to}. Không nhận được? Gửi link này cho họ: ${link}`
            : mail_sent === false
              ? `Đã mời ${to} nhưng gửi email không thành công. Gửi link này cho họ: ${link}`
              : `Đã mời ${to}; chưa xác nhận được email đã gửi. Nếu họ không nhận được, gửi link này: ${link}`,
      );
      setLast(mail_enabled ? { id, email: to, role: inviteRole } : null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    const { data, error: err } = await authClient.organization.inviteMember({ email, role, organizationId: ws });
    if (err) return setError(err.message ?? "Không mời được");
    await report(data?.id ?? "", email, role, "Đã gửi");
    setEmail("");
  }

  async function resend() {
    if (!last) return;
    setMessage(null);
    setError(null);
    setResending(true);
    try {
      const { data, error: err } = await authClient.organization.inviteMember({
        email: last.email,
        role: last.role,
        organizationId: ws,
        resend: true,
      });
      if (err) return setError(err.message ?? "Không gửi lại được");
      await report(data?.id ?? last.id, last.email, last.role, "Đã gửi lại");
    } finally {
      setResending(false);
    }
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
      {last && (
        <p>
          <button type="button" disabled={resending} onClick={() => void resend()}>
            Gửi lại email
          </button>
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </form>
  );
}
