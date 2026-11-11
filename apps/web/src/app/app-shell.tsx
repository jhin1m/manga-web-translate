/**
 * Khung app: thanh trên (brand → home `/`, slot phải, Hoạt động = upload của tab, chỉ hiện khi đang tải; menu tài khoản) + nội dung.
 * Mỗi người một tài khoản — dữ liệu luôn của người đang đăng nhập (`GET /api/me`). Editor toàn màn hình nằm ngoài
 * shell.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { ShellActivity } from "../features/chapter/activity-drawer.tsx";
import { readSeenVersion, UPDATE_STATUS_KEY, updateStatusQuery, writeSeenVersion } from "../features/update/api.ts";
import { UpdateDialog, type UpdateDialogMode } from "../features/update/update-dialog.tsx";
import { canUpdateInApp, failedRun, offeredVersion, showDot } from "../features/update/update-model.ts";
import { api, authClient, errorMessage, type Me, usd, useAppConfig } from "../lib/api.ts";
import { markDevSignedOut } from "../lib/dev-login.ts";
import "./app-shell.css";

export const meQuery = { queryKey: ["me"], queryFn: () => api<Me>("/api/me"), staleTime: 60_000 };

/** Đăng xuất rồi về /login (dev: tab này thôi tự đăng nhập). */
export function signOut() {
  markDevSignedOut();
  return authClient.signOut().then(() => location.assign("/login"));
}

const MeCtx = createContext<Me | null>(null);

/** Người dùng hiện tại + quyền admin + hạn mức — chỉ dùng bên trong AppShell. */
export function useMe(): Me {
  const me = useContext(MeCtx);
  if (!me) throw new Error("useMe outside AppShell");
  return me;
}

/** `children` cho trang gắn trực tiếp; không có → `<Outlet />`. */
export function AppShell({ right, children }: { right?: ReactNode; children?: ReactNode }) {
  const q = useQuery(meQuery);

  // Lỗi hỏi lại nền (vd app đang khởi động lại giữa lúc cập nhật) không được gỡ shell: còn data thì giữ nguyên.
  // Phiên hết hạn (401) đã có onSessionLost đưa về màn đăng nhập.
  if (q.error && !q.data) {
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
  const config = useAppConfig().data;
  const local = config?.local_mode === true;
  const qc = useQueryClient();
  const ref = useRef<HTMLDetailsElement>(null);
  const [seen, setSeen] = useState(readSeenVersion);
  const [dialog, setDialog] = useState<UpdateDialogMode | null>(null);
  const autoOpened = useRef(false);

  // Chỉ bản local (admin duy nhất) có cập nhật trong app; route 404 / lỗi → không có gì hiện ra.
  const status = useQuery(updateStatusQuery(local && me.is_admin)).data;
  const offered = offeredVersion(status);
  const dot = showDot(status, seen);
  const failed = failedRun(status);
  const running = status?.updater.run?.state === "running" ? status.updater.run : null;

  // Bấm ra ngoài → đóng menu.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenu(ref.current);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  // Mở lại trang giữa lúc đang cập nhật → tự mở hộp tiến độ.
  useEffect(() => {
    if (running && !autoOpened.current) {
      autoOpened.current = true;
      setDialog("running");
    }
  }, [running]);

  const onToggle = (open: boolean) => {
    if (!open || !offered) return;
    writeSeenVersion(offered);
    setSeen(offered);
  };

  const closeDialog = () => {
    setDialog(null);
    void qc.invalidateQueries({ queryKey: UPDATE_STATUS_KEY });
  };

  const dialogVersion = dialog === "running" || dialog === "error" ? (status?.updater.run?.target ?? offered) : offered;

  return (
    <>
      <details ref={ref} className="shell-menu" onToggle={(e) => onToggle(e.currentTarget.open)}>
        <summary
          aria-label={dot && offered ? `Tài khoản · có bản mới v${offered}` : "Tài khoản"}
          className="shell-avatar"
        >
          {initials(me.name || me.email || "?")}
          {dot && <span className="shell-avatar-dot" data-testid="update-dot" aria-hidden="true" />}
        </summary>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: đóng menu sau khi chọn mục (click lan từ link) */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: phím Enter trên link cũng phát click */}
        <div className="shell-menu-list" onClick={() => closeMenu(ref.current)}>
          <span className="shell-menu-email muted small">{me.email}</span>
          <Link to="/glossary">Glossary chung</Link>
          <Link to="/fonts">Font của tôi</Link>
          {me.is_admin && <Link to="/settings">Cài đặt</Link>}
          {me.quota.limit_usd !== null && (
            <span className="shell-menu-quota muted small" data-testid="quota-line">
              Hạn mức AI hôm nay: {usd(me.quota.spent_usd)} / {usd(me.quota.limit_usd)}
            </span>
          )}
          {status && failed && (
            <button type="button" className="shell-menu-failed" onClick={() => setDialog("error")}>
              Cập nhật v{failed.target} lỗi
            </button>
          )}
          {status && offered && status.latest && (
            <>
              <span className="shell-menu-update small">
                Có bản mới <strong>v{offered}</strong> ·{" "}
                <a href={status.latest.url} target="_blank" rel="noopener noreferrer">
                  Xem thay đổi
                </a>
              </span>
              <button type="button" onClick={() => setDialog(canUpdateInApp(status) ? "confirm" : "manual")}>
                {canUpdateInApp(status) ? "Cập nhật ngay" : "Cách cập nhật"}
              </button>
            </>
          )}
          {/* Chỉ bản local: bản nhiều người dùng không hiện phiên bản. API cũ không có `version` → ẩn. */}
          {local && config?.version && (
            <span className="shell-menu-version muted small" data-testid="version-line">
              MTL {config.version === "dev" ? "dev" : `v${config.version}`}
            </span>
          )}
          {/* Chế độ local không có tài khoản → không có đăng xuất. */}
          {!local && (
            <button type="button" onClick={() => void signOut()}>
              Đăng xuất
            </button>
          )}
        </div>
      </details>
      {status && dialog && dialogVersion && (
        <UpdateDialog status={status} mode={dialog} version={dialogVersion} onClose={closeDialog} />
      )}
    </>
  );
}
