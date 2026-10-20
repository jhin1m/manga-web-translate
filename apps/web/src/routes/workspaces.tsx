import { type FormEvent, useEffect, useState } from "react";
import { api, authClient, errorMessage, navigate, type WorkspaceDetail, type WorkspaceSummary } from "../lib/api.ts";

/** Chọn workspace; chỉ 1 workspace thì vào thẳng. */
export function WorkspacePickerPage() {
  const [list, setList] = useState<WorkspaceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ workspaces: WorkspaceSummary[] }>("/api/me/workspaces")
      .then(({ workspaces }) => {
        const only = workspaces.length === 1 ? workspaces[0] : undefined;
        if (only) navigate(`/w/${only.id}`);
        else setList(workspaces);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <main>
      <Bar title="Chọn workspace" />
      {error && <p className="error">{error}</p>}
      {list?.length === 0 && <p className="muted">Bạn chưa thuộc workspace nào. Hãy xin link mời.</p>}
      <ul className="plain">
        {list?.map((w) => (
          <li key={w.id}>
            <a
              href={`/w/${w.id}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/w/${w.id}`);
              }}
            >
              {w.name}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

/** Trang workspace (khung tạm cho Phase 4): thông tin + mời thành viên (owner/admin). */
export function WorkspaceHomePage({ ws }: { ws: string }) {
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<WorkspaceDetail>(`/api/w/${ws}`)
      .then(setDetail)
      .catch((e) => setError(errorMessage(e)));
  }, [ws]);

  return (
    <main>
      <Bar title={detail?.name ?? "Workspace"} />
      {error && <p className="error">{error}</p>}
      {detail && (
        <p className="muted">
          Vai trò: {detail.role} · Worker: {detail.settings.worker_mode}
        </p>
      )}
      {detail && detail.role !== "member" && <InviteForm ws={ws} />}
    </main>
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
    <form onSubmit={submit}>
      <h1 style={{ marginTop: 32 }}>Mời thành viên</h1>
      <label htmlFor="invite-email">Email</label>
      <input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="invite-role">Vai trò</label>
      <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
        <option value="member">member</option>
        <option value="admin">admin</option>
      </select>
      <button type="submit">Tạo lời mời</button>
      {message && <p style={{ wordBreak: "break-all" }}>{message}</p>}
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function Bar({ title }: { title: string }) {
  return (
    <header className="bar">
      <h1>{title}</h1>
      <button type="button" className="link" onClick={() => authClient.signOut().then(() => navigate("/login"))}>
        Đăng xuất
      </button>
    </header>
  );
}
