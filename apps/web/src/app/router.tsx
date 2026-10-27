/**
 * Cây route (TanStack Router, code-based, params type-safe). Component trong `features/*` nhận params qua
 * props — không import ngược router.
 *
 * Đích: `/` (home), `/s/$seriesId[?tab]`, `/s/$seriesId/c/$chapterId[?page&drawer]`, `/glossary[?src&tgt]`,
 * `/settings[?tab]`, `/login`. Mỗi người một tài khoản → không có id tài khoản trên URL.
 *
 * Màn chương (= editor gộp, `chapterRoute`) nằm dưới `authedRoute` nhưng NGOÀI `shellRoute` → chiếm toàn màn hình,
 * không có thanh trên của app shell.
 */
import { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { GlossaryPage } from "../features/glossary/glossary-editor.tsx";
import { HomePage } from "../features/home/home-page.tsx";
import { SOURCE_LANGS, type SourceLang, TARGET_LANGS, type TargetLang } from "../features/series/lang-labels.ts";
import { SeriesPage } from "../features/series/series-page.tsx";
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
  notFoundComponent: () => (
    <main className="auth">
      <h1>Không tìm thấy trang</h1>
      <Link to="/">Về trang chủ</Link>
    </main>
  ),
});

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "login", component: () => <LoginPage /> });

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
    return (
      <Suspense
        fallback={
          <p className="muted" style={{ padding: 16 }}>
            Đang tải màn chương…
          </p>
        }
      >
        {/* key: đổi chương = phiên mới (store dùng chung cả tab reset trước lần render đầu của màn chương). */}
        <ChapterWorkspace key={chapterId} seriesId={seriesId} chapterId={chapterId} page={page} drawer={drawer} />
      </Suspense>
    );
  },
});

/** Glossary chung theo cặp `?src=&tgt=`; thiếu/sai → Hàn → Việt. */
const glossaryRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "glossary",
  validateSearch: (search: Record<string, unknown>): { src?: SourceLang; tgt?: TargetLang } => ({
    ...(SOURCE_LANGS.includes(search.src as SourceLang) ? { src: search.src as SourceLang } : {}),
    ...(TARGET_LANGS.includes(search.tgt as TargetLang) ? { tgt: search.tgt as TargetLang } : {}),
  }),
  component: function GlossaryRoute() {
    const { src = "ko", tgt = "vi" } = glossaryRoute.useSearch();
    const navigate = glossaryRoute.useNavigate();
    return (
      <GlossaryPage
        pair={{ source_lang: src, target_lang: tgt }}
        onPairChange={(p) => void navigate({ search: { src: p.source_lang, tgt: p.target_lang }, replace: true })}
      />
    );
  },
});

export const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "settings",
  // `tab=pipeline`: tab Pipeline; không có = tab Font.
  validateSearch: (search: Record<string, unknown>): { tab?: "pipeline" } =>
    search.tab === "pipeline" ? { tab: "pipeline" } : {},
  component: function SettingsRoute() {
    const { tab } = settingsRoute.useSearch();
    return <SettingsPage tab={tab ?? "fonts"} />;
  },
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  authedRoute.addChildren([
    shellRoute.addChildren([homeRoute, seriesRoute, glossaryRoute, settingsRoute]),
    chapterRoute,
  ]),
]);

export const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
