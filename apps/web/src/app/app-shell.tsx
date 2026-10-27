/**
 * Khung app: thanh trên (brand → home `/`, slot phải, Hoạt động = upload của tab, menu tài khoản) + nội dung.
 * Mỗi người một tài khoản — dữ liệu luôn của người đang đăng nhập (`GET /api/me`). Editor toàn màn hình nằm ngoài
 * shell.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useEffect, useRef } from "react";
import { ShellActivity } from "../features/chapter/activity-drawer.tsx";
import { api, authClient, errorMessage, type Me } from "../lib/api.ts";
import { markDevSignedOut } from "../lib/dev-login.ts";
import "./app-shell.css";

export const meQuery = { queryKey: ["me"], queryFn: () => api<Me>("/api/me"), staleTime: 60_000 };

/** Đăng xuất rồi về /login (dev: tab này thôi tự đăng nhập). */
export function signOut() {
  markDevSignedOut();
  return authClient.signOut().then(() => location.assign("/login"));
}

const MeCtx = createContext<Me | null>(null);

/** Người dùng hiện tại + cài đặt chung — chỉ dùng bên trong AppShell. */
export function useMe(): Me {
  const me = useContext(MeCtx);
  if (!me) throw new Error("useMe outside AppShell");
  return me;
}

/** `children` cho trang gắn trực tiếp; không có → `<Outlet />`. */
export function AppShell({ right, children }: { right?: ReactNode; children?: ReactNode }) {
  const q = useQuery(meQuery);

  if (q.error) {
    return (
      <main className="auth">
        <h1>Không tải được tài khoản</h1>
        <p className="error">{errorMessage(q.error)}</p>
      </main>
    );
  }
  if (!q.data) return null;

  return (
    <MeCtx.Provider value={q.data}>
      <header className="shell-top">
        <Link to="/" className="shell-brand">
          MTL
        </Link>
        <span className="spacer" />
        {right}
        <ShellActivity />
        <AccountMenu />
      </header>
      {children ?? <Outlet />}
    </MeCtx.Provider>
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

function AccountMenu() {
  const me = useMe();
  const ref = useRef<HTMLDetailsElement>(null);

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
        {initials(me.name || me.email || "?")}
      </summary>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: đóng menu sau khi chọn mục (click lan từ link) */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: phím Enter trên link cũng phát click */}
      <div className="shell-menu-list" onClick={() => closeMenu(ref.current)}>
        <span className="shell-menu-email muted small">{me.email}</span>
        <Link to="/glossary">Glossary chung</Link>
        <Link to="/settings">Cài đặt chung</Link>
        <button type="button" onClick={() => void signOut()}>
          Đăng xuất
        </button>
      </div>
    </details>
  );
}
