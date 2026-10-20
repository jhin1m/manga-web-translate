# Phase 1 smoke report: dev login + app shell

Branch: feat/redesign-p1-dev-login-shell. Worktree: /Users/jhin1m/Desktop/ducanh-project/mtl-wt/r1. Ngày: 2026-10-20. Không sửa source file.

## 1. Gates

| Gate | Kết quả |
|---|---|
| `pnpm typecheck` (-r) | PASS, exit 0 (shared, db, web, api) |
| `pnpm lint` (biome) | PASS, exit 0, 189 file, không fix |
| `pnpm test` (-r) | PASS, exit 0 |

Chi tiết test:
- packages/shared: 1 file, 8/8
- packages/db: 1 file, 3/3
- apps/web: 10 file, 56/56
- apps/api: 18 file, 137/137 (24s, chủ yếu test thời gian thực)
- Tổng: 34 file, 204 test, 0 fail, 0 skip

## 2. Build web và kiểm tra dev path

- `pnpm --filter @mtl/web build`: PASS, exit 0, không có warning hay deprecation trong log.
- `grep -r "dev/auto-login" apps/web/dist`: rỗng (exit 1). `tryDevLogin` và `api/dev` cũng không xuất hiện trong bundle, nên guard `import.meta.env.DEV` hoạt động.

## 3. Live smoke (port riêng 5181 và 8798, DB mtl_test_e2e)

Setup:
- Seed: OK, workspace `d9e3480a-…`, series `01a15983-…`. Password không in ra report.
- API 8798: log `[dev] auto-login enabled for owner-e2e@example.com`, `api listening on http://localhost:8798`. `POST /api/dev/auto-login` trả 200.
- Vite 5181 (`--strictPort`): ready. `GET /` 200, proxy `/api/dev/auto-login` qua 5181 trả 200.

Playwright (context mới, Chromium headless, script throwaway trong scratchpad):

| Check | Kết quả |
|---|---|
| Mở `/` → auto-login, URL giữ `/`, heading "Series" hiện | PASS |
| Topbar có brand "MTL" | PASS |
| Avatar "Tài khoản" hiện | PASS |
| Mở menu → "Glossary chung", "Thành viên", "Đăng xuất" | PASS |
| `/w/<ws>` → `/` | PASS |
| `/w/<ws>/series` → `/` + heading "Series" | PASS |
| `/w/<ws>/series/<s>` → `/w/<ws>/s/<s>` | PASS |
| `/w/<ws>/series/<s>/settings` → `/w/<ws>/s/<s>?tab=settings` + heading "Cài đặt series" | PASS |
| Click link "Series e2e" ở home → `/w/<ws>/s/<s>` | PASS |
| Page errors | 0 |
| Console error/warning | 0 |
| HTTP >= 400 trong session | 0 |

Screenshot home: `/private/tmp/claude-501/-Users-jhin1m-Desktop-ducanh-project-mtl-wt-r1/7e0d9264-966d-44ca-83e2-50f43e8e6732/scratchpad/home.png`. Layout ổn: topbar MTL + "Nhóm e2e", avatar "O", bảng series có "Series e2e".

Negative check (POST `/api/dev/auto-login`):

| Instance | Config | Kết quả |
|---|---|---|
| 8799 | NODE_ENV=development, không có DEV_AUTO_LOGIN_* | 404 |
| 8800 | NODE_ENV=test, có DEV_AUTO_LOGIN_* | 404, không có log "auto-login enabled" |

Cleanup: đã dừng đúng 8 PID của mình (pnpm + node con cho 8798, vite 5181, 8799, 8800). Sau đó 5181, 8798, 8799, 8800 không còn listen. Owner vẫn listen: 5180 (PID 95870), 8787 (PID 95886). Không dùng pkill. Không chạy `pnpm --filter @mtl/web e2e`.

## 4. Coverage gap (diff-aware)

Changed src file có test:
- `apps/web/src/lib/current-workspace.ts` có `current-workspace.test.ts`.
- `apps/api/src/env.ts`, `app.ts`, `routes/dev-auth.ts` có `apps/api/test/dev-auto-login.test.ts` (4 case: boot prod bị chặn, điều kiện enable, route 404 khi NODE_ENV=test, login có cookie 7 ngày).

Changed file không có unit test:
- [!] `apps/web/src/lib/dev-login.ts`: chưa test `tryDevLogin` (guard DEV, memo promise một lần mỗi tab, fail → false). Gợi ý: unit test với stub `fetch` và `import.meta.env.DEV`.
- [!] `apps/web/src/app/app-shell.tsx` (file mới): không có unit test. Chỉ cover gián tiếp qua e2e `routes-redirect.spec.ts`. Gợi ý: test render shell với user mock, kiểm tra đổi workspace khi > 1 và menu đóng khi click ngoài.
- [!] `chapter-page.tsx`, `EditorPage.tsx`, `Toolbar.tsx`, `series-list-page.tsx`, `series-settings-page.tsx`, `upload-page.tsx`, `router.tsx`, `layout.tsx`, `workspaces.tsx`: thay đổi chỉ có e2e (`chapter-tools`, `editor`, `upload-chapter`, `routes-redirect`). Không chạy e2e theo ràng buộc port, nên chưa xác nhận các thay đổi này.

## 5. Concerns

- E2E Playwright suite (`apps/web/e2e/*`) chưa chạy. Config hardcode 5180 và cấm chạy, nên regression cho editor, chapter, upload và routes chỉ được xác nhận qua smoke. Đây là rủi ro lớn nhất.
- Log Vite có event `hmr update` cho `router.tsx`, `workspaces.tsx`, `app-shell.tsx`, `layout.tsx` lúc 20:33:52. Mtime của các file này là 20:27–20:28, tức trước lúc chạy smoke và không có thay đổi nội dung. Có thể là watcher event do process khác (session khác hoặc tool git) touch file. Không ảnh hưởng kết quả vì smoke đã pass, nhưng cần xác nhận không có session nào đang sửa file trong worktree này.
- Lần đầu gọi `/api/dev/auto-login` không kiểm tra lỗi mạng (`fetch` lỗi → false). Đây là hành vi đúng cho dev, không phải bug.

## Critical issues

Không có.

## Recommendations

1. Thêm unit test cho `dev-login.ts`: guard DEV, memo, lỗi mạng.
2. Thêm test cho `app-shell.tsx`: menu, switch workspace, đóng menu khi click ngoài.
3. Chạy e2e suite trên port riêng (ví dụ bằng `E2E` env có sẵn trong `e2e/env.ts`) khi owner cho phép. Ưu tiên `routes-redirect.spec.ts`, `editor.spec.ts`, `chapter-tools.spec.ts`.

## Next steps

1. Owner quyết định có chạy e2e trên port khác không. Nếu không, chấp nhận rủi ro smoke-only.
2. Viết unit test cho `dev-login.ts` và `app-shell.tsx`.
3. Xác nhận không có session khác sửa file trong r1.

## Unresolved questions

- Ai hoặc tiến trình nào tạo event HMR lúc 20:33:52 trên các file r1 (mtime cũ)?
- E2E có cần pass trước khi merge phase 1 không, hay chấp nhận smoke thủ công?

Status: DONE_WITH_CONCERNS
Summary: Typecheck, lint, test (204 test) và build đều pass. Dev auto-login và app shell pass smoke Playwright trên 5181/8798: redirect, menu, console sạch. Route 404 khi tắt dev. Gap: chưa chạy e2e suite, và `dev-login.ts`, `app-shell.tsx` chưa có unit test. Đã dọn process của mình, owner 5180/8787 vẫn chạy.
