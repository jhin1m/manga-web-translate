/**
 * Cây route (TanStack Router, code-based, params type-safe). Component trong `features/*` nhận params qua
 * props — không import ngược router.
 *
 * Phase 5 (editor): thay `component` của `editorRoute` bằng màn editor. Route này nằm dưới `authedRoute` nhưng
 * NGOÀI `workspaceRoute` → editor chiếm toàn màn hình, không có thanh trên của workspace.
 */
import { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter, Link, Outlet, redirect } from "@tanstack/react-router";
import { ChapterPage } from "../features/chapter/chapter-page.tsx";
import { WorkspaceGlossaryPage } from "../features/glossary/glossary-editor.tsx";
import { SeriesDetailPage, SeriesListPage } from "../features/series/series-list-page.tsx";
import { SeriesSettingsPage } from "../features/series/series-settings-page.tsx";
import { UploadPage } from "../features/upload/upload-page.tsx";
import { AcceptInvitePage } from "../routes/accept-invite.tsx";
import { LoginPage } from "../routes/login.tsx";
import { MembersPage, WorkspacePickerPage } from "../routes/workspaces.tsx";
import { AuthGate, WorkspaceLayout } from "./layout.tsx";

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

const pickerRoute = createRoute({ getParentRoute: () => authedRoute, path: "/", component: WorkspacePickerPage });

export const workspaceRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "w/$ws",
  component: function WorkspaceRouteComponent() {
    const { ws } = workspaceRoute.useParams();
    return <WorkspaceLayout ws={ws} />;
  },
});

const workspaceIndexRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/w/$ws/series", params: { ws: params.ws } });
  },
});

const seriesListRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "series",
  component: function SeriesListRoute() {
    const { ws } = seriesListRoute.useParams();
    return <SeriesListPage ws={ws} />;
  },
});

const seriesDetailRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "series/$seriesId",
  component: function SeriesDetailRoute() {
    const { ws, seriesId } = seriesDetailRoute.useParams();
    return <SeriesDetailPage ws={ws} seriesId={seriesId} />;
  },
});

const seriesSettingsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "series/$seriesId/settings",
  component: function SeriesSettingsRoute() {
    const { ws, seriesId } = seriesSettingsRoute.useParams();
    return <SeriesSettingsPage ws={ws} seriesId={seriesId} />;
  },
});

const uploadRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "series/$seriesId/upload",
  component: function UploadRoute() {
    const { ws, seriesId } = uploadRoute.useParams();
    return <UploadPage ws={ws} seriesId={seriesId} />;
  },
});

export const chapterRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "series/$seriesId/chapters/$chapterId",
  component: function ChapterRoute() {
    const { ws, seriesId, chapterId } = chapterRoute.useParams();
    return <ChapterPage ws={ws} seriesId={seriesId} chapterId={chapterId} />;
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

/** Editor 1 trang (Phase 5 thay component). */
export const editorRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "w/$ws/series/$seriesId/chapters/$chapterId/edit/$pageId",
  component: function EditorPlaceholder() {
    const { ws, seriesId, chapterId } = editorRoute.useParams();
    return (
      <main className="auth">
        <h1>Editor</h1>
        <p className="muted">Editor sẽ có ở Phase 5.</p>
        <Link to="/w/$ws/series/$seriesId/chapters/$chapterId" params={{ ws, seriesId, chapterId }}>
          Quay lại chương
        </Link>
      </main>
    );
  },
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  acceptInviteRoute,
  authedRoute.addChildren([
    pickerRoute,
    workspaceRoute.addChildren([
      workspaceIndexRoute,
      seriesListRoute,
      seriesDetailRoute,
      seriesSettingsRoute,
      uploadRoute,
      chapterRoute,
      glossaryRoute,
      membersRoute,
    ]),
    editorRoute,
  ]),
]);

export const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
