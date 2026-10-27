---
phase: 3
title: "Web một người dùng"
status: completed
priority: P1
effort: "1d"
dependencies: [1, 2]
---

# Phase 3: Web một người dùng

## Overview
Bỏ `$ws` khỏi route và mọi component, bỏ chọn/đổi workspace, Thành viên, lời mời, role; thêm đăng ký trên
`/login`; "Cài đặt nhóm" → "Cài đặt chung"; đơn giản hoá UI khoá chương; cập nhật e2e.

## Requirements
- Functional:
  - Route: `/` (home), `/s/$seriesId[?tab]`, `/s/$seriesId/c/$chapterId[?page&drawer]`, `/glossary[?src&tgt]`,
    `/settings[?tab=pipeline]`, `/login`. Xoá `/workspaces`, `/w/$ws/members`, `/accept-invite`, mọi redirect legacy
    `/w/$ws/...` (`router.tsx:206-250`; production chưa có người dùng → không cần giữ bookmark).
  - `/login`: 2 chế độ Đăng nhập / Đăng ký (tên, email, mật khẩu ≥ 10) trên cùng trang; đăng ký thành công →
    `signIn.email` ngay (server `autoSignIn: false`) → `/`; đăng ký đang tắt → "Hiện chưa mở đăng ký"; 429 → "Thử
    lại sau ít phút".
  - Menu tài khoản: email, Glossary chung, **Cài đặt chung**, Đăng xuất.
  - Không còn gate role: font upload/xoá, pipeline, xoá series/chương luôn hiện cho chủ tài khoản.
  <!-- Red Team: khoá theo tab; 423 "tab khác" giờ là thật — 2026-10-24 -->
  - Khoá chương (D6): `lib/api.ts` gửi header `X-Tab-Id` (uuid sinh 1 lần, lưu `sessionStorage`, try/catch) với mọi
    request. Giữ `use-chapter-lock.ts` (acquire/heartbeat/release); nhánh `denied` đổi chữ: "Chương đang mở ở tab
    khác — chỉ xem ở tab này" (bỏ `holderName`, "Thành viên khác", "X đang sửa chương này", câu 423 khi xoá chương ở
    `home-page.tsx:239`/`series-page.tsx:314` → "Chương đang mở để sửa ở một tab — đóng tab đó rồi xoá").
  - Lỗi 402 / job lỗi `quota_exceeded` → "Đã dùng hết hạn mức hôm nay ($x / $y) — thử lại sau HH:mm" (qua
    `describeJobError` / `errorMessage`). Cài đặt chung hiện 1 dòng hạn mức hôm nay nếu `limit_usd` có.
- Non-functional: giữ a11y hiện có (tab, aria), không thêm dependency.

## Architecture
- `lib/api.ts`: bỏ `organizationClient()`, header lời mời, `wsPath`, `WorkspaceSummary/Detail` → `Me` (`GET /api/me`).
- `lib/current-workspace.ts` (+ test): xoá. `app-shell.tsx`: `WorkspaceCtx/useWorkspace → MeCtx/useMe`, bỏ
  `WorkspaceSwitcher`, `AppShell` không nhận `ws`.
- 46 file khớp `ws|wsPath|useWorkspace|$ws` (scout đếm 42 theo thư mục: chapter 13, editor 5, series 6, glossary 3,
  home 3, upload 3, fonts 2, app 2, lib 2, routes 2, pipeline 1): bỏ prop + đổi path `/api/w/${ws}/x` → `/api/x`;
  query key bỏ `ws`.
- Đổi chữ: `routes/workspace-settings.tsx → routes/settings.tsx` ("Cài đặt chung", aria "Mục cài đặt chung");
  "Font của nhóm" → "Font của bạn" (`font-settings.tsx:44-45`, `series-settings-form.tsx:293,329`,
  `editor/panels/Properties.tsx:63`); pipeline "Áp dụng cho mọi series của bạn", bỏ "Chỉ chủ nhóm / quản trị viên…".
  **Giữ** "Tên nhóm dịch" (`series-settings-form.tsx:240`, nghĩa nhóm dịch truyện).
- Xoá: `routes/workspaces.tsx`, `routes/accept-invite.tsx`.

## Related Code Files
- Modify: `apps/web/src/app/{router,app-shell}.tsx`, `apps/web/src/lib/api.ts`, `routes/login.tsx`,
  46 file feature (danh sách trong scout report), `features/chapter/{use-chapter-lock.ts,lock-banner.tsx,
  chapter-topbar.tsx,chapter-workspace.tsx,text-utils.ts}`, `features/editor/use-chapter-session.ts`,
  `features/{home/home-page,series/series-page}.tsx` (423 holder_name khi xoá).
<!-- Red Team: Playwright chờ URL đã bị xoá — 2026-10-24 -->
- E2E: `apps/web/playwright.config.ts:23` readiness `/api/me/workspaces` → `/api/me` (401 = sống);
  `e2e/{env,seed,helpers}.ts` (`state.workspaceId` bỏ, seed `createUser`), 11 spec dùng `/w/${ws}`;
  `routes-redirect.spec.ts` xoá phần `/w/` (giữ redirect khác nếu còn); `workspace-fonts.spec.ts → fonts.spec.ts`
  ("Cài đặt chung", "Font của bạn"); `editor.spec.ts:321-345` bỏ mock 423 → ca thật 2 page (2 tab) cùng chương:
  tab 2 chỉ xem, đóng tab 1 không làm tab 2 mất dữ liệu, tab 2 lấy được khoá sau đó.
  Thêm `signup.spec.ts`: đăng ký → vào home rỗng → tạo series.
- Delete: `routes/{workspaces,accept-invite}.tsx`, `lib/current-workspace{,.test}.ts`.

## Implementation Steps
1. `lib/api.ts` + `useMe` + router mới + app shell + menu.
2. Bỏ prop `ws` theo thư mục feature (typecheck dẫn đường).
3. Login/đăng ký; settings "Cài đặt chung"; đổi chữ; bỏ role gate.
4. UI khoá chương + thông báo 402 + dòng hạn mức.
5. E2E: seed/helpers, sửa spec, thêm `signup.spec.ts`.
6. Gate: typecheck, lint, `pnpm --filter @mtl/web test`, `pnpm --filter @mtl/web e2e`.

## Success Criteria
- [x] `grep -rniE "workspace|\\$ws|wsPath|Thành viên|lời mời|Cài đặt nhóm|của nhóm|holder_?name" apps/web/src` chỉ còn
      allowlist: "Tên nhóm dịch", tên component `chapter-workspace*`.
- [x] E2E đầy đủ xanh, gồm `signup.spec.ts`.
- [ ] Soi tay: đăng ký → tạo series → upload → dịch → editor → xuất chạy trọn (việc của owner; e2e `signup`,
      `full-flow` đã phủ tự động).

## Risk Assessment
- **Đổi đồng loạt 46 file** dễ sót query key/URL → typecheck + e2e; grep `/api/w/` = 0.
- **localStorage `mtl.ws` cũ** vô hại; không cần dọn.
- **`sessionStorage` bị chặn** (private mode) → tabId sinh trong bộ nhớ cho phiên trang; nhân bản tab (duplicate)
  copy `sessionStorage` → 2 tab cùng tabId: chấp nhận (version `If-Match` vẫn chặn ghi đè, `page-state.ts:142-163`).
