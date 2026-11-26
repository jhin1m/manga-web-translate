/**
 * Cây route (TanStack Router, code-based, params type-safe). Component trong `features/*` nhận params qua
 * props — không import ngược router.
 *
 * Đích: `/` (home), `/s/$seriesId[?tab]`, `/s/$seriesId/c/$chapterId[?page&drawer]`,
 * `/settings[?section]` (Font cho mọi người; mục AI / Hệ thống chỉ admin), `/login`; `/fonts` cũ chuyển sang
 * `/settings?section=fonts`. Mỗi người một tài khoản → không có id tài khoản trên URL.
 *
 * Màn chương (= editor gộp, `chapterRoute`) nằm dưới `authedRoute` nhưng NGOÀI `shellRoute` → chiếm toàn màn hình,
 * không có thanh trên của app shell.
 */
import { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter, Link, Outlet, redirect } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { type SettingsSection, validSection } from "../features/admin/admin-sections.ts";
import { HomePage } from "../features/home/home-page.tsx";
import { SeriesPage } from "../features/series/series-page.tsx";
import { useT } from "../i18n/t.ts";
import { appConfigQuery } from "../lib/api.ts";
import { LoginPage } from "../routes/login.tsx";
import { SettingsPage } from "../routes/settings.tsx";
import { AppShell } from "./app-shell.tsx";
import { AuthGate } from "./layout.tsx";

// Chunk riêng (konva + immer + zustand…): chỉ tải khi mở màn chương.
const ChapterWorkspace = lazy(() =>
  import("../features/chapter/chapter-workspace.tsx").then((m) => ({ default: m.ChapterWorkspace })),
);

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 5_000 } },
});

export type RouterContext = { queryClient: QueryClient };

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: function NotFound() {
    const { t } = useT();
    return (
      <main className="auth">
        <h1>{t("app.router.notFound")}</h1>
        <Link to="/">{t("app.router.backHome")}</Link>
      </main>
    );
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "login",
  // `reason=disabled`: vừa bị đăng xuất vì tài khoản bị khoá (xem `api()`).
  validateSearch: (search: Record<string, unknown>): { reason?: "disabled" } =>
    search.reason === "disabled" ? { reason: "disabled" } : {},
  // Chế độ local không có tài khoản → /login về trang chủ. Lỗi tải config → vẫn hiện màn đăng nhập.
  beforeLoad: async ({ context }) => {
    const config = await context.queryClient.ensureQueryData(appConfigQuery).catch(() => null);
    if (config?.local_mode) throw redirect({ to: "/" });
  },
  component: () => <LoginPage reason={loginRoute.useSearch().reason} />,
});

/** Mọi route cần đăng nhập. */
export const authedRoute = createRoute({ getParentRoute: () => rootRoute, id: "authed", component: AuthGate });

/** Trang có thanh trên của app (mọi thứ trừ màn chương). */
const shellRoute = createRoute({ getParentRoute: () => authedRoute, id: "shell", component: () => <AppShell /> });

const homeRoute = createRoute({ getParentRoute: () => shellRoute, path: "/", component: HomePage });

const SERIES_TABS = ["chapters", "glossary", "settings"] as const;
export type SeriesTab = (typeof SERIES_TABS)[number];
const isSeriesTab = (v: unknown): v is SeriesTab => SERIES_TABS.includes(v as SeriesTab);

export const seriesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "s/$seriesId",
  validateSearch: (search: Record<string, unknown>): { tab?: SeriesTab } =>
    isSeriesTab(search.tab) ? { tab: search.tab } : {},
  component: function SeriesRoute() {
    const { seriesId } = seriesRoute.useParams();
    const { tab } = seriesRoute.useSearch();
    return <SeriesPage seriesId={seriesId} tab={tab} />;
  },
});

/** Màn chương = editor gộp (toàn màn hình). */
export const chapterRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "s/$seriesId/c/$chapterId",
  // `drawer=export`: mở thẳng drawer Xuất (nút "Xuất lại" ở home / danh sách chương).
  validateSearch: (search: Record<string, unknown>): { page?: string; drawer?: "export" } => ({
    ...(typeof search.page === "string" ? { page: search.page } : {}),
    ...(search.drawer === "export" ? { drawer: "export" as const } : {}),
  }),
  component: function ChapterRoute() {
    const { seriesId, chapterId } = chapterRoute.useParams();
    const { page, drawer } = chapterRoute.useSearch();
    const { t } = useT();
    return (
      <Suspense
        fallback={
          <p className="muted" style={{ padding: 16 }}>
            {t("app.router.loadingChapter")}
          </p>
        }
      >
        {/* key: đổi chương = phiên mới (store dùng chung cả tab reset trước lần render đầu của màn chương). */}
        <ChapterWorkspace key={chapterId} seriesId={seriesId} chapterId={chapterId} page={page} drawer={drawer} />
      </Suspense>
    );
  },
});

export const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "settings",
  // `section`: mục Cài đặt; thiếu/lạ = mục đầu. Mục người này không được thấy (theo quyền admin / chế độ local) do
  // SettingsPage đưa về mục đầu.
  validateSearch: (search: Record<string, unknown>): { section?: SettingsSection } => {
    const section = validSection(search.section);
    return section ? { section } : {};
  },
  component: function SettingsRoute() {
    return <SettingsPage section={settingsRoute.useSearch().section} />;
  },
});

/** Link / bookmark cũ: trang Font nay là một mục của Cài đặt. */
const fontsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "fonts",
  beforeLoad: () => {
    throw redirect({ to: "/settings", search: { section: "fonts" }, replace: true });
  },
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  authedRoute.addChildren([shellRoute.addChildren([homeRoute, seriesRoute, settingsRoute, fontsRoute]), chapterRoute]),
]);

export const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
