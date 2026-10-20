/**
 * Cổng đăng nhập cho mọi route cần phiên. Dev (`import.meta.env.DEV`): chưa có phiên → thử POST
 * /api/dev/auto-login đúng 1 lần rồi lấy lại phiên; không bật/thất bại → màn đăng nhập.
 */
import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authClient } from "../lib/api.ts";
import { tryDevLogin } from "../lib/dev-login.ts";
import { LoginPage } from "../routes/login.tsx";

export function AuthGate() {
  const { data: session, isPending, refetch } = authClient.useSession();
  const path = useRouterState({ select: (s) => s.location.href });
  const [devTried, setDevTried] = useState(!import.meta.env.DEV);

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
