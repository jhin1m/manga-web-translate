# Cook report — Redesign P1: dev auto-login, app shell, router mới

Branch: `feat/redesign-p1-dev-login-shell` (chưa merge). Phase: `plans/261020-1944-web-uiux-redesign-chapter-workspace/phase-01-dev-login-app-shell-router.md` → status completed (plan.md không sửa).

## Đã làm
- API (chỉ thêm, không migration):
  - `env.ts`: `parseEnv(raw)` thuần; `DEV_AUTO_LOGIN_EMAIL/PASSWORD`; production + bất kỳ biến DEV_AUTO_LOGIN_* → boot lỗi; `devAutoLoginEnabled(e)` = development + đủ creds + `BETTER_AUTH_URL` host localhost/127.0.0.1.
  - `routes/dev-auth.ts`: `POST /api/dev/auto-login` → `auth.api.signInEmail(..., asResponse)`; log `[dev] auto-login enabled for …`.
  - `app.ts`: `createApp({ devAutoLogin })` mount có điều kiện. **Lệch plan**: tham số là `{email,password} | false` thay vì `true` (test inject user seed; mặc định lấy từ env).
  - `auth.ts`: `session: { expiresIn: 7d, updateAge: 1d }` tường minh (= mặc định better-auth).
  - `test/dev-auto-login.test.ts`: boot prod throw (email hoặc password), ma trận enabled, 404 mặc định, 200 + `Max-Age=604800`.
- Web:
  - `lib/current-workspace.ts` (+test 4 case): `resolveCurrentWs`, localStorage `mtl.ws` qua `useSyncExternalStore` (đổi ws tại `/` render lại ngay).
  - `lib/dev-login.ts`: chỉ DEV, 1 promise/lần tải trang; đăng xuất → cờ sessionStorage, tab đó thôi tự đăng nhập.
  - `app/layout.tsx`: AuthGate thử dev login 1 lần → refetch session → else LoginPage.
  - `app/app-shell.tsx` + `app-shell.css`: topbar 48px theo design Main (MTL → `/`, tên ws / select khi >1, slot `right` cho P5, avatar menu: Glossary chung / Thành viên / Đăng xuất). Thay `WorkspaceLayout`; `useWorkspace` dời vào đây.
  - `app/router.tsx`: `/`, `/workspaces`, `/w/$ws/s/$seriesId?tab`, `/w/$ws/s/$seriesId/c/$chapterId?page`; redirect `/w/$ws`, `/series`, `/series/$s`, `/series/$s/settings`, `/series/$s/chapters/$c`; giữ `upload` (P2) + editor `edit/$pageId` (P3).
  - Link nội bộ đổi sang path mới (series-list, series-settings, chapter-page, upload-page, EditorPage, Toolbar, workspaces picker).
- E2E: `e2e/helpers.ts` (`login`, `state`), 3 spec dùng helper + URL mới, spec mới `routes-redirect.spec.ts`; `e2e/env.ts` ép `DEV_AUTO_LOGIN_*=""` cho API e2e.
- Docs: `docs/development-setup.md` (mục Dev auto-login, session 7 ngày, cây route, app shell); `.env.example` 2 biến.

## Kiểm chứng
- `pnpm typecheck` ✓, `pnpm lint` ✓, `pnpm test` ✓ (api 137, web 56, shared 8, db 3).
- `pnpm --filter @mtl/web build` → `grep -r "dev/auto-login" apps/web/dist` = 0.
- Worker `uv run pytest`: 132 passed, 2 skipped.
- Smoke Playwright (tester, cổng 5181/8798, DB `mtl_test_e2e`): auto-login vào `/`, topbar + menu đúng, 4 redirect đúng, click series → `/w/<ws>/s/<s>`, 0 lỗi console; route 404 khi tắt env/NODE_ENV=test. Báo cáo: `tester-261020-redesign-p1-smoke-report.md`.
- E2E typecheck ad-hoc sạch.
- E2E Playwright: lượt đầu bỏ qua (cổng cứng 5180 trùng `pnpm dev` owner). Sau khi controller chốt → e2e chuyển cổng riêng (xem mục dưới), `pnpm --filter @mtl/web e2e` **7/7 xanh** (chapter-tools 3, editor, routes-redirect, typeset-parity, upload-chapter) trên Vite 5181 + API 8797; 5180/8787 owner không bị đụng.

## Review (code-reviewer, 0 critical)
- Đã sửa: H1 đổi workspace tại `/` không render lại (→ store subscribe); M2 env e2e; M3 đăng xuất ở dev bị tự đăng nhập lại (→ cờ sessionStorage); L2 side effect trong render picker; L4 dead export `workspaceQuery`; L7 chặn cả PASSWORD ở prod.
- Để lại: L1 `beforeLoad` ghi `mtl.ws` trước khi biết membership (resolve vẫn lọc; tệ nhất về picker); L3 home lỗi/0 workspace chưa có hướng dẫn (P2 làm home mới); L5 CSS `.topbar` trong `styles/tokens.css` thành dead code — file ngoài phạm vi P1, dọn ở P6; L6 dev route không check Origin (chỉ dev, localhost, tác động không đáng kể).
- Fix H1 sau smoke chưa có e2e 2 workspace (seed e2e chỉ 1 ws).

## E2E cổng riêng (controller chốt: CÓ)
- `apps/web/e2e/env.ts`: `WEB_PORT` mặc định 5181 (`E2E_WEB_PORT`), `API_PORT` 8797 (`E2E_API_PORT`).
- `infra/docker-compose.dev.yml`: `MINIO_API_CORS_ALLOW_ORIGIN` = `${WEB_ORIGIN:-…5180},${E2E_WEB_ORIGIN:-…5181}`; đã recreate chỉ `mtl-dev-minio-1` + `mtl-dev-files-proxy-1` (volume giữ nguyên, postgres không đụng). Preflight 9100 trả đúng ACAO cho cả 5180 và 5181.
- Lưu ý: container mtl-dev trước đó dựng từ compose của worktree `p2`; chạy `pnpm infra:up` từ checkout chưa có thay đổi này (trước khi merge) sẽ đưa CORS về chỉ 5180.
- Docs: `docs/development-setup.md` mục Test.
