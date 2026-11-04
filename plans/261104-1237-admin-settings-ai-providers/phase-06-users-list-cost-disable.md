---
phase: 6
title: "Người dùng (list, chi phí, khoá/mở)"
status: completed
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 6: Người dùng (list, chi phí, khoá/mở)

## Overview

Mục **Hệ thống › Người dùng**: danh sách user + chi phí hôm nay / 30 ngày, khoá/mở tài khoản (D7, T3). Khoá tự làm,
không plugin admin của better-auth (research mục 2). Migration **0024 `user_disabled_at`**.

## Requirements

- Functional:
  - `GET /api/admin/users?q=` → `[{ id, email, name, created_at, disabled_at, is_admin, cost_today_usd, cost_30d_usd }]`,
    sắp `created_at` mới trước, tối đa 500, `q` lọc email/tên (`ilike`, escape `%`/`_`).
  - `POST /api/admin/users/:id/disable` → set `disabled_at = now()` **rồi** `internalAdapter.deleteUserSessions(id)`;
    `POST /api/admin/users/:id/enable` → `disabled_at = null`. Khoá chính mình hoặc email ∈ `ADMIN_EMAILS` → 409
    `cannot_disable_admin`. User không tồn tại → 404.
  - User bị khoá: request kế tiếp với cookie cũ → 401 (session đã xoá); đăng nhập đúng mật khẩu → 403 `USER_DISABLED`;
    `requireUser` gặp session còn sót (race) → 403 `user_disabled`.
  <!-- red-team -->
  - Claim **không** nhận job của user có `disabled_at` (job đang chạy chạy nốt; không attempt mới, không lô dịch kế); mở
    khoá → job đang chờ chạy tiếp. Dispatcher không bật Modal cho job của họ.
  - Web: bảng (email, tên, ngày tạo, hôm nay, 30 ngày, trạng thái), icon khoá/mở (`aria-label`), xác nhận trước khi khoá;
    dòng admin không có nút khoá. Login: `USER_DISABLED` → "Tài khoản đã bị khoá."
  <!-- red-team -->
  - Web: `api()` gặp **401** → báo better-auth refetch session (`authClient.$store.notify("$sessionSignal")`) → `AuthGate`
    hiện `LoginPage` ngay (không cần reload/focus); gặp **403 `user_disabled`** → `authClient.signOut()` rồi về
    `/login?reason=disabled` (LoginPage hiện "Tài khoản đã bị khoá.").
- Non-functional: 1 truy vấn cho list (aggregate ledger theo `user_id` 30 ngày, `filter` cho hôm nay UTC như `budget.ts:32`).

## Architecture

- `apps/api/src/auth.ts`: `user: { additionalFields: { disabledAt: { type: "date", required: false, input: false } } }`
  (bắt buộc: `AuthSession["user"]` có field cho `requireUser`). <!-- red-team --> `databaseHooks.session.create.before(session)`
  **fail-closed**: luôn tra `db.select({ disabledAt: user.disabledAt }).from(user).where(eq(user.id, session.userId))`
  bằng drizzle `db` của API (không phụ thuộc `ctx`) → có `disabledAt` → `throw new APIError("FORBIDDEN", { message:
  "Account disabled", code: "USER_DISABLED" })`. An toàn với `pnpm create-user`: script chỉ `createUser` + `linkAccount`,
  không tạo session (`apps/api/src/lib/create-user.ts`, research mục 1) → hook không chạy; dev auto-login đi qua endpoint.
  Comment: **không bật `session.cookieCache`** (bật thì khoá chậm tới `maxAge`).
- `pnpm auth:generate` → `packages/db/src/schema/auth.ts` có `disabledAt: timestamp("disabled_at")` → `pnpm --filter
  @mtl/db generate --name user_disabled_at` → `0024_user_disabled_at.sql` + down `ALTER TABLE "user" DROP COLUMN "disabled_at";`.
- `apps/api/src/middleware/user.ts:26-27`: sau `getSession`, `if (s.user.disabledAt) throw new HTTPException(403, {
  res: Response.json({ error: "user_disabled" }, { status: 403 }) })`.
- <!-- red-team --> `apps/api/src/billing/user-quota.ts:37` `claimableSql(kind)` thêm `not exists (select 1 from "user" u where
  u.id = jobs.user_id and u.disabled_at is not null)` → áp cho claim (`queue.ts:113`) và dispatcher (`dispatcher.ts:156`)
  cùng lúc. Heartbeat job đang chạy không đổi.
- `apps/api/src/routes/admin-users.ts` (mount trong `adminApi()`); khoá dùng `(await auth.$context).internalAdapter
  .deleteUserSessions(id)` (nhận **userId**; đừng nhầm `deleteSessions(tokens)`). Thứ tự set cờ → xoá session.
- Web: `apps/web/src/features/admin/users-section.tsx`, `users-model.ts` (thuần: định dạng tiền, ai được khoá),
  `admin-sections.ts` mục `users`; `apps/web/src/routes/login.tsx:14` thêm mã + `?reason=disabled`;
  `apps/web/src/app/router.tsx:44` `loginRoute.validateSearch` (`reason?`); <!-- red-team --> `apps/web/src/lib/api.ts:51-55`
  nhánh 401 + 403 `user_disabled`; `apps/web/src/app/layout.tsx:11-40` (`AuthGate`) nhận tín hiệu session (kiểm rằng
  `useSession` refetch khi `$sessionSignal` — không thì gọi `refetch()` qua store chung).

**Data flow**: admin bấm khoá → API set `user.disabled_at` → xoá session DB → claim bỏ job của user → request kế của user:
401 → `api()` báo session → `AuthGate` hiện login → đăng nhập → hook `session.create.before` → 403 `USER_DISABLED`.

## Related Code Files

- Create:
  - `packages/db/migrations/0024_user_disabled_at.sql` (+ snapshot/journal), `packages/db/migrations-down/0024_user_disabled_at.down.sql`
  - `apps/api/src/routes/admin-users.ts`, `apps/api/test/admin-users.test.ts`
  - `apps/web/src/features/admin/users-section.tsx`, `users-model.ts`, `users-model.test.ts`
- Modify:
  - `apps/api/src/auth.ts`, `packages/db/src/schema/auth.ts` (sinh bởi `auth:generate`), `apps/api/src/middleware/user.ts`,
    `apps/api/src/routes/admin.ts`, `apps/api/src/billing/user-quota.ts`
  - `apps/api/test/user-quota.test.ts`, `apps/api/test/dispatcher.test.ts` (ca user bị khoá)
  - `apps/web/src/features/admin/admin-sections.ts`, `api.ts`, `apps/web/src/routes/login.tsx`, `apps/web/src/lib/api.ts`,
    `apps/web/src/lib/api.test.ts`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/router.tsx`
  - `apps/web/e2e/admin-settings.spec.ts`
  - `docs/deployment-guide.md` (vận hành: khoá tài khoản), README "Phase 8" (admin nền tảng một phần đã có)
- Delete: không.

## Implementation Steps

### Tests Before
1. `apps/api/test/signup.test.ts:40` (script tạo user đăng nhập được) + `apps/api/test/dev-auto-login.test.ts` xanh —
   khoá rằng hook `session.create` fail-closed không chặn user thường / dev login / create-user.
2. `apps/api/test/tenant-isolation.test.ts` + `user-quota.test.ts:118,138` (claim theo quota) + `dispatcher.test.ts` xanh —
   khoá `requireUser`/`claimableSql` trước khi thêm điều kiện.
3. `apps/web/src/lib/api.test.ts` xanh (khoá `ApiError` cho status ≠ 401).

### Refactor / Implement
4. `additionalFields` + `auth:generate` + `db:generate` + down file; kiểm diff schema auth chỉ thêm 1 cột.
5. Hook fail-closed; check trong `requireUser`; điều kiện `claimableSql`.
6. `admin-users.ts` (list aggregate, disable/enable); mount.
7. Web mục Người dùng + login + `api.ts` + `AuthGate`; docs.

### Tests After
8. `admin-users.test.ts`:
   - list có chi phí hôm nay / 30 ngày đúng từ `usage_ledger` (seed dòng hôm qua + 31 ngày trước → đúng cột); `q` lọc;
     user thường → 403 (quét phase 1).
   - khoá → cookie cũ `GET /api/me` → 401; `signIn` đúng mật khẩu → 403 `USER_DISABLED`; mở → đăng nhập lại được.
   - khoá chính mình / email admin (cả dạng viết hoa trong env) → 409; id lạ → 404.
   - race: đặt `disabled_at` trực tiếp DB (không xoá session) → `requireUser` 403 `user_disabled`.
   - claim: job `queued` của user bị khoá không được claim, job user khác vẫn claim; mở khoá → claim được; dispatcher
     không tính job của họ.
   - `createUser()` vẫn chạy khi có hook.
9. Web unit `api.test.ts`: 401 → gọi notify session; 403 `user_disabled` → signOut + điều hướng; 403 khác → `ApiError` như
   cũ. `users-model.test.ts`. E2E: admin khoá user seed → context của user đó thao tác kế tiếp hiện trang login (không
   reload), đăng nhập báo "Tài khoản đã bị khoá."; mở → vào lại được.

### Regression Gate
```bash
pnpm auth:generate && git diff --exit-code packages/db/src/schema/auth.ts   # schema khớp config
pnpm --filter @mtl/db generate                                               # No schema changes
pnpm typecheck && pnpm lint
pnpm --filter @mtl/db test && pnpm --filter @mtl/api test && pnpm --filter @mtl/web test
pnpm --filter @mtl/web e2e admin-settings signup
```

## Success Criteria

- [x] Khoá → web về login ngay ở thao tác kế; đăng nhập lại 403 `USER_DISABLED`; mở khoá → dùng lại được.
- [x] Job của user bị khoá không được claim/dispatch; mở khoá → chạy tiếp.
- [x] Không khoá được admin / chính mình.
- [x] Danh sách chi phí khớp ledger (UTC).
- [x] `auth:generate` + `db:generate` không còn diff.

**Kết quả (2026-11-04)**: xong, review 8/10 (1 High); fix H1 (`oldest_queued_age_s` bỏ job user bị khoá, dùng chung `notDisabledOwnerSql`),
M1 (docs rollback), L1–L6 đã áp. Lệch: `AuthGate` bỏ dev auto-login sau khi từng có session (tránh tự đăng nhập lại owner dev);
`admin-users.ts` dùng `inJobTx`; 403 `user_disabled` dùng `window.location.assign`. Job `queued` của user bị khoá vẫn nằm hàng đợi (câu hỏi mở 7).
Báo cáo: `plans/reports/from-fullstack-developer-261104-1506-phase-06-users-admin-report.md`,
`plans/reports/from-code-reviewer-261104-1514-phase-06-review-report.md`.

## Risk Assessment

| Rủi ro | Khả năng × Tác động | Giảm thiểu |
|---|---|---|
| Thiếu `additionalFields` → `requireUser` không thấy cờ | TB × Cao | Hook tra DB trực tiếp (không dựa `findUserById`); test đăng nhập sau khi khoá |
| Bật `cookieCache` sau này làm khoá chậm | Thấp × TB | Comment tại `auth.ts`; claim vẫn chặn job ngay |
| `auth:generate` sinh lại cả file, đổi format | TB × Thấp | Review diff; chỉ chấp nhận thêm cột |
| Aggregate 30 ngày chậm khi ledger lớn | Thấp × Thấp | Giới hạn 500 user, lọc 30 ngày; index `(user_id, created_at)` nếu `EXPLAIN` cần |
| <!-- red-team --> Job đang chờ của user bị khoá nằm trong hàng đợi lâu | TB × Thấp | Không claim/không tốn tiền; mở khoá chạy tiếp; câu hỏi mở về huỷ hẳn |
| Hook fail-closed thêm 1 query mỗi lần đăng nhập | Chắc × Thấp | Query PK; đăng nhập hiếm |

Rollback: revert code; cột `disabled_at` additive (down file). Bản cũ không đọc cột → user bị khoá đăng nhập lại được
(ghi docs rollback).
