/**
 * Cổng đăng nhập cho mọi route cần phiên. Chế độ local (`/api/config`): không có tài khoản → vào thẳng app.
 * Bản nhiều người dùng — `SessionGate` (component riêng để hook phiên không gọi có điều kiện). Dev (`import.meta.env.DEV`): chưa có phiên → thử POST
 * /api/dev/auto-login đúng 1 lần rồi lấy lại phiên; không bật/thất bại → màn đăng nhập.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { syncLocaleToServer } from "../i18n/i18n-store.ts";
import { useT } from "../i18n/t.ts";
import { authClient, type Me, putUiLocale, useAppConfig } from "../lib/api.ts";
import { tryDevLogin } from "../lib/dev-login.ts";
import { LoginPage } from "../routes/login.tsx";
import { meQuery } from "./app-shell.tsx";

export function AuthGate() {
  const { t } = useT();
  const config = useAppConfig();
  if (config.isPending) return null;
  // Không biết chế độ chạy thì không đoán (đoán sai ở bản local = form đăng nhập không bao giờ dùng được).
  if (config.isError) {
    return (
      <main className="auth">
        <h1>{t("app.layout.serverDownTitle")}</h1>
        <p className="muted">{t("app.layout.serverDownHint")}</p>
        <button type="button" onClick={() => void config.refetch()} disabled={config.isFetching}>
          {t("common.retry")}
        </button>
      </main>
    );
  }
  if (config.data.local_mode) return <Authed />;
  return <SessionGate />;
}

/** Đã có người dùng (phiên hoặc bản local): nội dung route + đồng bộ ngôn ngữ giao diện lên server. */
function Authed() {
  return (
    <>
      <LocaleSync />
      <Outlet />
    </>
  );
}

/**
 * Ghi chú AI (giọng văn, lý do hiệu đính) viết theo ngôn ngữ giao diện lưu trên server: so với `GET /api/me` một lần khi
 * tải xong, sau đó gửi mỗi lần người dùng đổi ngôn ngữ. Đặt ở cổng đăng nhập (không ở AppShell) để cả trang ngoài shell
 * như editor cũng đồng bộ.
 */
function LocaleSync() {
  const qc = useQueryClient();
  const me = useQuery(meQuery).data;
  const loaded = me !== undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ so với server lúc /api/me tải xong; sau đó store tự báo khi đổi
  useEffect(() => {
    if (!me) return;
    return syncLocaleToServer(me.ui_locale, async (code) => {
      const saved = await putUiLocale(code);
      qc.setQueryData<Me>(meQuery.queryKey, (m) => (m ? { ...m, ui_locale: saved.ui_locale } : m));
    });
  }, [loaded, qc]);
  return null;
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
  return <Authed />;
}
