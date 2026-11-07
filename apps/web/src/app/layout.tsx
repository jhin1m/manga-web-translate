/**
 * Cổng đăng nhập cho mọi route cần phiên. Chế độ local (`/api/config`): không có tài khoản → vào thẳng app.
 * Bản nhiều người dùng — `SessionGate` (component riêng để hook phiên không gọi có điều kiện). Dev (`import.meta.env.DEV`): chưa có phiên → thử POST
 * /api/dev/auto-login đúng 1 lần rồi lấy lại phiên; không bật/thất bại → màn đăng nhập.
 */
import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authClient, useAppConfig } from "../lib/api.ts";
import { tryDevLogin } from "../lib/dev-login.ts";
import { LoginPage } from "../routes/login.tsx";

export function AuthGate() {
  const config = useAppConfig();
  if (config.isPending) return null;
  // Không biết chế độ chạy thì không đoán (đoán sai ở bản local = form đăng nhập không bao giờ dùng được).
  if (config.isError) {
    return (
      <main className="auth">
        <h1>Không kết nối được máy chủ</h1>
        <p className="muted">Kiểm tra máy chủ đang chạy rồi thử lại.</p>
        <button type="button" onClick={() => void config.refetch()} disabled={config.isFetching}>
          Thử lại
        </button>
      </main>
    );
  }
  if (config.data.local_mode) return <Outlet />;
  return <SessionGate />;
}

function SessionGate() {
  const { data: session, isPending, refetch } = authClient.useSession();
  const path = useRouterState({ select: (s) => s.location.href });
  const [devTried, setDevTried] = useState(!import.meta.env.DEV);

  // Đã có phiên rồi mất giữa chừng (hết hạn, bị khoá) → màn đăng nhập, không tự đăng nhập lại bằng tài khoản dev.
  useEffect(() => {
    if (session) setDevTried(true);
  }, [session]);

  useEffect(() => {
    if (!import.meta.env.DEV || isPending || session || devTried) return;
    let alive = true;
    void tryDevLogin()
      .then(async (ok) => {
        if (ok) await refetch();
      })
      .finally(() => alive && setDevTried(true));
    return () => {
      alive = false;
    };
  }, [isPending, session, devTried, refetch]);

  if (isPending) return null;
  if (!session) return devTried ? <LoginPage next={path} /> : null;
  return <Outlet />;
}
