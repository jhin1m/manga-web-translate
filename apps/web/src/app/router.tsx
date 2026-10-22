/**
 * Cây route (TanStack Router, code-based, params type-safe). Component trong `features/*` nhận params qua
 * props — không import ngược router.
 *
 * Đích: `/` (home workspace hiện tại), `/w/$ws/s/$seriesId[?tab]`, `/w/$ws/s/$seriesId/c/$chapterId[?page]`.
 * Path cũ `/w/$ws/series/...` (kể cả trang upload cũ và editor 1 trang `.../edit/$pageId`) redirect sang path mới.
 *
 * Màn chương (= editor gộp, `chapterRoute`) nằm dưới `authedRoute` nhưng NGOÀI `workspaceRoute` → chiếm toàn
 * màn hình, không có thanh trên của app shell.
 */
import { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Navigate,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";
import { WorkspaceGlossaryPage } from "../features/glossary/glossary-editor.tsx";
import { HomePage } from "../features/home/home-page.tsx";
import { SeriesPage } from "../features/series/series-page.tsx";
import { errorMessage } from "../lib/api.ts";
import { setCurrentWs, useCurrentWorkspace } from "../lib/current-workspace.ts";
import { AcceptInvitePage } from "../routes/accept-invite.tsx";
import { LoginPage } from "../routes/login.tsx";
import { MembersPage, WorkspacePickerPage } from "../routes/workspaces.tsx";
import { AppShell, useWorkspace } from "./app-shell.tsx";
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
const acceptInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "accept-invite",
  component: AcceptInvitePage,
});

/** Mọi route cần đăng nhập. */
export const authedRoute = createRoute({ getParentRoute: () => rootRoute, id: "authed", component: AuthGate });

/** Home của workspace hiện tại; chưa xác định được → picker. */
const homeRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/",
  component: function HomeRoute() {
    const { current, error } = useCurrentWorkspace();
    if (error) {
      return (
        <main className="auth">
          <p className="error">{errorMessage(error)}</p>
        </main>
      );
    }
    if (!current) return null;
    if (!("ws" in current)) return <Navigate to="/workspaces" replace />;
    return (
      <AppShell ws={current.ws}>
        <HomePage ws={current.ws} />
      </AppShell>
    );
  },
});

const pickerRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "workspaces",
  component: WorkspacePickerPage,
});

export const workspaceRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "w/$ws",
  component: function WorkspaceRouteComponent() {
    const { ws } = workspaceRoute.useParams();
    return <AppShell ws={ws} />;
  },
});

const workspaceIndexRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/",
  beforeLoad: ({ params }) => {
    setCurrentWs(params.ws);
    throw redirect({ to: "/", replace: true });
  },
});

const SERIES_TABS = ["chapters", "glossary", "settings"] as const;
export type SeriesTab = (typeof SERIES_TABS)[number];
const isSeriesTab = (v: unknown): v is SeriesTab => SERIES_TABS.includes(v as SeriesTab);

export const seriesRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "s/$seriesId",
  validateSearch: (search: Record<string, unknown>): { tab?: SeriesTab } =>
    isSeriesTab(search.tab) ? { tab: search.tab } : {},
  component: function SeriesRoute() {
    const { ws, seriesId } = seriesRoute.useParams();
    const { tab } = seriesRoute.useSearch();
    const { role } = useWorkspace();
    return <SeriesPage ws={ws} seriesId={seriesId} tab={tab} canDeleteSeries={role !== "member"} />;
  },
});

/** Màn chương = editor gộp (toàn màn hình). */
export const chapterRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "w/$ws/s/$seriesId/c/$chapterId",
  // `drawer=export`: mở thẳng drawer Xuất (nút "Xuất lại" ở home / danh sách chương).
  validateSearch: (search: Record<string, unknown>): { page?: string; drawer?: "export" } => ({
    ...(typeof search.page === "string" ? { page: search.page } : {}),
    ...(search.drawer === "export" ? { drawer: "export" as const } : {}),
  }),
  component: function ChapterRoute() {
    const { ws, seriesId, chapterId } = chapterRoute.useParams();
    const { page, drawer } = chapterRoute.useSearch();
    // Ngoài app shell: tự ghi workspace hiện tại (home `/` mở lại đúng chỗ).
    useEffect(() => setCurrentWs(ws), [ws]);
    return (
      <Suspense
        fallback={
          <p className="muted" style={{ padding: 16 }}>
            Đang tải màn chương…
          </p>
        }
      >
        {/* key: đổi chương = phiên mới (store dùng chung cả tab reset trước lần render đầu của màn chương). */}
        <ChapterWorkspace
          key={chapterId}
          ws={ws}
          seriesId={seriesId}
          chapterId={chapterId}
          page={page}
          drawer={drawer}
        />
      </Suspense>
    );
  },
});

const glossaryRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "glossary",
  component: function GlossaryRoute() {
    const { ws } = glossaryRoute.useParams();
    return <WorkspaceGlossaryPage ws={ws} />;
  },
});

const membersRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "members", component: MembersPage });

// ---- Path cũ → path mới (giữ bookmark/link cũ). ----
const legacySeriesListRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "series",
  beforeLoad: ({ params }) => {
    setCurrentWs(params.ws);
    throw redirect({ to: "/", replace: true });
  },
});

const legacySeriesRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "series/$seriesId",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/w/$ws/s/$seriesId", params, replace: true });
  },
});

const legacySeriesSettingsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "series/$seriesId/settings",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/w/$ws/s/$seriesId", params, search: { tab: "settings" }, replace: true });
  },
});

/** Trang upload riêng đã bỏ: upload = thả file ở home/series. */
const legacyUploadRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "series/$seriesId/upload",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/w/$ws/s/$seriesId", params, replace: true });
  },
});

const legacyChapterRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "series/$seriesId/chapters/$chapterId",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/w/$ws/s/$seriesId/c/$chapterId", params, replace: true });
  },
});

/** Editor 1 trang cũ → màn chương mở đúng page. */
const legacyEditorRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "series/$seriesId/chapters/$chapterId/edit/$pageId",
  beforeLoad: ({ params: { pageId, ...params } }) => {
    throw redirect({ to: "/w/$ws/s/$seriesId/c/$chapterId", params, search: { page: pageId }, replace: true });
  },
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  acceptInviteRoute,
  authedRoute.addChildren([
    homeRoute,
    pickerRoute,
    workspaceRoute.addChildren([
      workspaceIndexRoute,
      seriesRoute,
      glossaryRoute,
      membersRoute,
      legacySeriesListRoute,
      legacySeriesRoute,
      legacySeriesSettingsRoute,
      legacyUploadRoute,
      legacyChapterRoute,
      legacyEditorRoute,
    ]),
    chapterRoute,
  ]),
]);

export const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
