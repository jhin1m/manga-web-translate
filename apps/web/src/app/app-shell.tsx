/**
 * Khung app của 1 workspace: thanh trên (brand → home `/`, đổi workspace khi > 1, slot phải, Hoạt động = upload
 * của tab, menu tài khoản) + nội dung. Vào được workspace nào thì ghi nó thành workspace hiện tại (home `/` mở lại đúng chỗ).
 * Editor toàn màn hình nằm ngoài shell.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useEffect, useRef } from "react";
import { ShellActivity } from "../features/chapter/activity-drawer.tsx";
import { api, authClient, errorMessage, type WorkspaceDetail, wsPath } from "../lib/api.ts";
import { setCurrentWs, useMyWorkspaces } from "../lib/current-workspace.ts";
import { markDevSignedOut } from "../lib/dev-login.ts";
import "./app-shell.css";

const useWorkspaceQuery = (ws: string) =>
  useQuery({ queryKey: ["workspace", ws], queryFn: () => api<WorkspaceDetail>(wsPath(ws)), staleTime: 5 * 60_000 });

/** Đăng xuất rồi về /login (dev: tab này thôi tự đăng nhập). */
export function signOut() {
  markDevSignedOut();
  return authClient.signOut().then(() => location.assign("/login"));
}

const WorkspaceCtx = createContext<WorkspaceDetail | null>(null);

/** Workspace hiện tại — chỉ dùng bên trong AppShell. */
export function useWorkspace(): WorkspaceDetail {
  const w = useContext(WorkspaceCtx);
  if (!w) throw new Error("useWorkspace outside AppShell");
  return w;
}

/** `children` cho trang gắn trực tiếp (home `/`); không có → `<Outlet />` của route `/w/$ws`. */
export function AppShell({ ws, right, children }: { ws: string; right?: ReactNode; children?: ReactNode }) {
  const q = useWorkspaceQuery(ws);
  const ok = !!q.data;
  useEffect(() => {
    if (ok) setCurrentWs(ws);
  }, [ok, ws]);

  if (q.error) {
    return (
      <main className="auth">
        <h1>Không mở được workspace</h1>
        <p className="error">{errorMessage(q.error)}</p>
        <Link to="/workspaces">Chọn workspace khác</Link>
      </main>
    );
  }
  if (!q.data) return null;

  return (
    <WorkspaceCtx.Provider value={q.data}>
      <header className="shell-top">
        <Link to="/" className="shell-brand">
          MTL
        </Link>
        <WorkspaceSwitcher current={q.data} />
        <span className="spacer" />
        {right}
        <ShellActivity ws={ws} />
        <AccountMenu ws={ws} />
      </header>
      {children ?? <Outlet />}
    </WorkspaceCtx.Provider>
  );
}

/** Tên workspace; nhiều workspace → chọn để đổi (về home của workspace đó). */
function WorkspaceSwitcher({ current }: { current: WorkspaceDetail }) {
  const list = useMyWorkspaces().data?.workspaces ?? [];
  const navigate = useNavigate();
  if (list.length <= 1) return <span className="shell-ws">{current.name}</span>;
  return (
    <select
      className="shell-ws-select"
      aria-label="Đổi workspace"
      value={current.id}
      onChange={(e) => {
        setCurrentWs(e.target.value);
        void navigate({ to: "/" });
      }}
    >
      {list.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </select>
  );
}

const closeMenu = (el: HTMLDetailsElement | null) => el?.removeAttribute("open");

const initials = (name: string) =>
  name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

function AccountMenu({ ws }: { ws: string }) {
  const { data: session } = authClient.useSession();
  const ref = useRef<HTMLDetailsElement>(null);
  const user = session?.user;

  // Bấm ra ngoài → đóng menu.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenu(ref.current);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  return (
    <details ref={ref} className="shell-menu">
      <summary aria-label="Tài khoản" className="shell-avatar">
        {initials(user?.name || user?.email || "?")}
      </summary>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: đóng menu sau khi chọn mục (click lan từ link) */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: phím Enter trên link cũng phát click */}
      <div className="shell-menu-list" onClick={() => closeMenu(ref.current)}>
        <span className="shell-menu-email muted small">{user?.email}</span>
        <Link to="/w/$ws/glossary" params={{ ws }}>
          Glossary chung
        </Link>
        <Link to="/w/$ws/members" params={{ ws }}>
          Thành viên
        </Link>
        <Link to="/w/$ws/settings" params={{ ws }}>
          Cài đặt nhóm
        </Link>
        <button type="button" onClick={() => void signOut()}>
          Đăng xuất
        </button>
      </div>
    </details>
  );
}
