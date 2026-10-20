/**
 * Khung app: cổng đăng nhập + layout workspace (thanh trên, điều hướng). Editor (Phase 5) gắn dưới
 * AuthGate nhưng NGOÀI WorkspaceLayout để dùng toàn màn hình — vẫn lấy được workspace qua `useWorkspaceQuery`.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { createContext, useContext } from "react";
import { api, authClient, errorMessage, type WorkspaceDetail, wsPath } from "../lib/api.ts";
import { LoginPage } from "../routes/login.tsx";

export function AuthGate() {
  const { data: session, isPending } = authClient.useSession();
  const path = useRouterState({ select: (s) => s.location.href });
  if (isPending) return null;
  if (!session) return <LoginPage next={path} />;
  return <Outlet />;
}

export const workspaceQuery = (ws: string) => ({
  queryKey: ["workspace", ws],
  queryFn: () => api<WorkspaceDetail>(wsPath(ws)),
  staleTime: 5 * 60_000,
});

export const useWorkspaceQuery = (ws: string) => useQuery(workspaceQuery(ws));

const WorkspaceCtx = createContext<WorkspaceDetail | null>(null);

/** Workspace hiện tại — chỉ dùng bên trong WorkspaceLayout. */
export function useWorkspace(): WorkspaceDetail {
  const w = useContext(WorkspaceCtx);
  if (!w) throw new Error("useWorkspace outside WorkspaceLayout");
  return w;
}

export function WorkspaceLayout({ ws }: { ws: string }) {
  const q = useWorkspaceQuery(ws);
  const { data: session } = authClient.useSession();

  if (q.error) {
    return (
      <main className="auth">
        <h1>Không mở được workspace</h1>
        <p className="error">{errorMessage(q.error)}</p>
        <Link to="/">Chọn workspace khác</Link>
      </main>
    );
  }
  if (!q.data) return null;

  return (
    <WorkspaceCtx.Provider value={q.data}>
      <header className="topbar">
        <Link to="/w/$ws/series" params={{ ws }} className="brand">
          {q.data.name}
        </Link>
        <nav>
          <Link to="/w/$ws/series" params={{ ws }}>
            Series
          </Link>
          <Link to="/w/$ws/glossary" params={{ ws }}>
            Glossary chung
          </Link>
          <Link to="/w/$ws/members" params={{ ws }}>
            Thành viên
          </Link>
        </nav>
        <span className="spacer" />
        <span className="muted small">{session?.user.email}</span>
        <Link to="/" className="small">
          Đổi workspace
        </Link>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => authClient.signOut().then(() => location.assign("/login"))}
        >
          Đăng xuất
        </button>
      </header>
      <Outlet />
    </WorkspaceCtx.Provider>
  );
}
