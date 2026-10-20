---
phase: 1
title: "Nền: dev auto-login, app shell, router mới + redirect"
status: completed
priority: P1
effort: 1.5d
dependencies: []
---

# Phase 1: Nền — dev auto-login, app shell, router mới + redirect

## Overview
Đặt nền cho các phase sau: (a) dev tự đăng nhập an toàn, (b) session 7 ngày ghi tường minh, (c) cây route đích (`/`, `/w/:ws/s/:series`, `/w/:ws/s/:series/c/:chapter`) gắn tạm vào màn cũ, redirect route cũ trừ `upload` (P2) và `edit/:pageId` (P3), (d) app shell mới, picker workspace chỉ khi > 1.

## Requirements
- Auto-login chạy khi và chỉ khi: `NODE_ENV === "development"` + `DEV_AUTO_LOGIN_EMAIL` + `DEV_AUTO_LOGIN_PASSWORD` đặt + `BETTER_AUTH_URL` host là `localhost`/`127.0.0.1`. `NODE_ENV=production` mà có `DEV_AUTO_LOGIN_EMAIL` → API **không khởi động** (lỗi env). Lý do guard host: `env.ts` mặc định `NODE_ENV=development` khi không đặt (`apps/api/src/env.ts:11`); prod đặt `NODE_ENV=production` qua systemd (`infra/systemd/mtl-api.service:14`) nhưng không dựa một lớp.
- Web chỉ gọi auto-login trong bundle dev (`import.meta.env.DEV`, bị loại khỏi build prod).
- Session: thêm `session: { expiresIn: 7*24*3600, updateAge: 24*3600 }` vào `betterAuth({...})` (`apps/api/src/auth.ts:25`) = đúng mặc định better-auth 1.7.11, chỉ làm tường minh. Cookie phiên sống 7 ngày, tự gia hạn khi dùng ≥ 1 lần/ngày.
- `/` = home của workspace hiện tại (P1: nội dung tạm = `SeriesListPage`). Workspace hiện tại = localStorage `mtl.ws` nếu còn là thành viên; không có → workspace duy nhất; > 1 và chưa chọn → picker.
- Không còn link nội bộ trỏ path cũ (typecheck của TanStack Router bắt).

## Architecture
```
rootRoute
├─ /login, /accept-invite
└─ authed (AuthGate: session? → Outlet | DEV: thử POST /api/dev/auto-login 1 lần → refetch | LoginPage)
   ├─ /                     HomeRoute → resolveCurrentWs → <AppShell ws> SeriesListPage(tạm)
   ├─ /workspaces           WorkspacePickerPage (đổi workspace; tự vào nếu chỉ 1)
   └─ /w/$ws                AppShell
      ├─ index              → setCurrentWs(ws); redirect "/"
      ├─ s/$seriesId        validateSearch {tab?: chapters|glossary|settings} → SeriesDetailPage | SeriesSettingsPage (tạm)
      ├─ s/$seriesId/c/$chapterId   validateSearch {page?: string} → ChapterPage (tạm)
      ├─ glossary, members  giữ
      ├─ series             → redirect "/"
      ├─ series/$s          → redirect s/$s ;  series/$s/settings → s/$s?tab=settings
      ├─ series/$s/chapters/$c → redirect s/$s/c/$c
      └─ series/$s/upload   GIỮ (UploadPage) tới P2
   editorRoute (path cũ .../edit/$pageId) GIỮ tới P3
```
API: `routes/dev-auth.ts` → `POST /api/dev/auto-login` gọi `auth.api.signInEmail({ body:{email,password}, headers, asResponse:true })` và trả nguyên Response (Set-Cookie của better-auth). Mount có điều kiện trong `createApp({ devAutoLogin })`, mặc định `devAutoLoginEnabled(env)`.

## Related Code Files
Create:
- `apps/api/src/routes/dev-auth.ts`
- `apps/api/test/dev-auto-login.test.ts`
- `apps/web/src/lib/current-workspace.ts` (+ `current-workspace.test.ts`)
- `apps/web/src/lib/dev-login.ts`
- `apps/web/src/app/app-shell.tsx` (topbar mới: brand → `/`, switcher khi > 1 workspace, slot phải cho nút Hoạt động (P5), menu: Glossary chung / Thành viên / Đăng xuất)
- `apps/web/e2e/helpers.ts` (`login(page)`, `state` — DRY 4 spec)

Modify:
- `apps/api/src/env.ts` (2 biến mới, `parseEnv(raw)` thuần, `devAutoLoginEnabled(e)`, superRefine chặn production)
- `apps/api/src/app.ts` (`createApp(opts)` mount có điều kiện)
- `apps/api/src/auth.ts:25` (session tường minh)
- `.env.example` (2 biến, comment "chỉ dev")
- `apps/web/src/app/router.tsx` (cây mới ở trên)
- `apps/web/src/app/layout.tsx` (AuthGate + dev login; bỏ `WorkspaceLayout`, giữ `useWorkspace`/`workspaceQuery` dời vào app-shell hoặc giữ export)
- `apps/web/src/routes/workspaces.tsx:15,27` (Navigate/Link → `/` + `setCurrentWs`)
- Link path cũ (đổi sang path mới): `apps/web/src/features/series/series-list-page.tsx:22,66,81,107,114,141`, `series-settings-page.tsx:45,49`, `features/chapter/chapter-page.tsx:101,105`, `features/editor/EditorPage.tsx:226`, `features/editor/panels/Toolbar.tsx:41`, `features/upload/upload-page.tsx:132,158,162,291`. Giữ nguyên link tới `/upload` (`series-list-page.tsx:77,117`, `chapter-page.tsx:194`) và tới `edit/$pageId` (`chapter-page.tsx:256`, `FindReplace.tsx:232`, `EditorPage.tsx:218`).
- `apps/web/e2e/{upload-chapter,editor,chapter-tools,typeset-parity}.spec.ts` (dùng `helpers.login`; assert heading home mới; URL chương mới)
- `docs/development-setup.md` (mục "Dev auto-login" + session 7 ngày)

Delete: không.

## Implementation Steps
1. `env.ts`: tách `Env` schema → `export function parseEnv(raw)`; thêm `DEV_AUTO_LOGIN_EMAIL: blank(z.string().email().optional())`, `DEV_AUTO_LOGIN_PASSWORD: blank(z.string().min(10).optional())`; superRefine: production + email → issue. `export const devAutoLoginEnabled = (e) => e.NODE_ENV === "development" && !!e.DEV_AUTO_LOGIN_EMAIL && !!e.DEV_AUTO_LOGIN_PASSWORD && ["localhost","127.0.0.1"].includes(new URL(e.BETTER_AUTH_URL).hostname)`.
2. `dev-auth.ts`: 1 route POST; log `console.warn("[dev] auto-login enabled for <email>")` lúc mount.
3. `app.ts`: `createApp({ devAutoLogin = devAutoLoginEnabled(env) } = {})`.
4. `auth.ts`: thêm `session` tường minh + comment "7 ngày, gia hạn mỗi ngày".
5. Test API (mục Success Criteria).
6. Web `current-workspace.ts`: `resolveCurrentWs(list, stored): {ws} | {pick: true} | {none: true}` thuần + hook `useCurrentWorkspace()`.
7. `dev-login.ts`: `tryDevLogin(): Promise<boolean>` (POST, 404/lỗi → false, cờ module chỉ thử 1 lần/tab). AuthGate: `if (!session && import.meta.env.DEV && !tried)` → chờ → `authClient.getSession()` refetch.
8. `app-shell.tsx` + router mới + redirect (`beforeLoad: throw redirect(...)`), sửa link liệt kê ở trên tới khi `pnpm --filter @mtl/web typecheck` sạch.
9. Cập nhật e2e (login helper, URL), docs dev-setup.

## Success Criteria
- `apps/api/test/dev-auto-login.test.ts` (vitest):
  - `parseEnv({...base, NODE_ENV:"production", DEV_AUTO_LOGIN_EMAIL:"a@x.io", ...budget})` throw.
  - `devAutoLoginEnabled` = false với `NODE_ENV` test/production, thiếu email/password, `BETTER_AUTH_URL=https://app.example.com`; = true với dev + localhost.
  - `createApp()` (vitest chạy `NODE_ENV=test`) → `POST /api/dev/auto-login` = 404.
  - `createApp({ devAutoLogin: true })` + user seed → 200, `set-cookie` chứa `better-auth.session_token` và `Max-Age=604800`.
- `current-workspace.test.ts`: 0 workspace → none; 1 → ws đó (bỏ qua stored lạ); 2 + stored hợp lệ → stored; 2 + không stored → pick.
- E2E (Playwright, cập nhật): login → thấy home tại `/`; `page.goto('/w/<ws>/series/<s>')` → URL `/w/<ws>/s/<s>`; `/w/<ws>/series/<s>/chapters/<c>` → `/w/<ws>/s/<s>/c/<c>`; `/w/<ws>/series/<s>/settings` → `?tab=settings`. Thêm 3 case này vào `upload-chapter.spec.ts` hoặc spec mới `routes-redirect.spec.ts`.
- `pnpm typecheck && pnpm lint && pnpm test` xanh; `pnpm --filter @mtl/web e2e` xanh.
- `pnpm --filter @mtl/web build` rồi `grep -r "dev/auto-login" apps/web/dist` = 0 kết quả.

## Risk Assessment
| Rủi ro | L×I | Giảm thiểu |
|---|---|---|
| Auto-login lọt production | L×H | 4 điều kiện + boot fail khi prod có env + route không mount + bundle prod không có code; test cả 3 lớp |
| Mật khẩu dev trong `.env` | L×L | `.env` đã gitignore; chỉ máy dev; ghi rõ docs |
| Link cũ sót → 404 | M×M | TanStack Router typed `to` → typecheck lỗi; redirect cho bookmark |
| e2e hỏng do đổi heading/URL | H×L | Sửa cùng PR, helper `login()` chung |
Rollback: revert PR; không migration.
