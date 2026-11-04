---
phase: 1
title: "Nền admin + layout + /fonts + pipeline chung"
status: completed
priority: P1
effort: "1.25d"
dependencies: []
---

# Phase 1: Nền admin + layout + `/fonts` + pipeline chung

## Overview

Khái niệm admin qua `ADMIN_EMAILS` (D2), router `/api/admin/*` có `requireAdmin`, chặn đăng ký bằng email admin, bảng
singleton `system_settings`, pipeline settings chuyển từ `user_settings` sang `system_settings` bằng SQL migration (D1),
web: `/settings` admin-only có thanh mục trái, font cá nhân sang `/fonts`, menu avatar thêm "Font của tôi" + hạn mức hôm nay.

## Requirements

- Functional:
  - `GET /api/me` thêm `is_admin: boolean`; bỏ `settings` (pipeline giờ của hệ thống, chỉ admin đọc qua admin API).
  - `GET /api/admin/settings` → `{ pipeline }` (phase 2/5 bổ sung slot, `limits`). `PUT /api/admin/settings/pipeline`
    thay `PUT /api/settings/pipeline` (route cũ **xoá**). User thường → 403 `forbidden` cho mọi `/api/admin/*`; chưa
    đăng nhập → 401.
  <!-- red-team -->
  - `POST /api/auth/sign-up/email` với email thuộc `ADMIN_EMAILS` (so sau `trim().toLowerCase()`) → **luôn** 400
    `EMAIL_PASSWORD_SIGN_UP_DISABLED` (cùng phản hồi như đăng ký tắt), dù đăng ký đang bật. Tài khoản admin chỉ tạo bằng
    `pnpm create-user`.
  - Enqueue mọi job đọc pipeline của **hệ thống**. Mặc định giữ nguyên hành vi/input_rev hiện tại.
  - Web: user thường không thấy link "Cài đặt", vào `/settings` → redirect `/`; `/fonts` = trang font cá nhân
    (`FontSettings` hiện có); menu avatar: email · Glossary chung · Font của tôi · (admin) Cài đặt · dòng "Hạn mức AI hôm
    nay" (chỉ khi có giới hạn, chuyển từ `routes/settings.tsx:17`) · Đăng xuất.
  - `/settings?section=pipeline` (mặc định khi chưa có mục khác): thanh mục trái + 1 panel phải; phase sau thêm mục.
- Non-functional: không đổi hợp đồng worker; migration additive; chuyển dữ liệu 1 lần trong SQL (không code boot).

## Architecture

**Admin** — `apps/api/src/env.ts:11` thêm `ADMIN_EMAILS: blank(z.string().optional()).transform(csv → string[])`
(mặc định `[]`). `apps/api/src/middleware/admin.ts`: `normalizeEmail = (s) => s.trim().toLowerCase()`,
`isAdminEmail(email)` chuẩn hoá **cả hai phía** (phần tử env + email cần so), đọc `env.ADMIN_EMAILS` lúc gọi;
`requireAdmin` → `HTTPException(403, forbidden)`.

<!-- red-team -->
**Chặn chiếm admin** — `apps/api/src/auth.ts`: thêm `hooks.before: createAuthMiddleware(ctx => ...)` (import
`createAuthMiddleware`, `APIError` từ `better-auth/api`): `ctx.path === "/sign-up/email"` và `isAdminEmail(ctx.body?.email)`
→ `throw new APIError("BAD_REQUEST", { message: "Email and password sign up is not enabled", code:
"EMAIL_PASSWORD_SIGN_UP_DISABLED" })`. Chạy trước handler nên không tạo user, không lộ email tồn tại. `disableSignUp`
(`auth.ts:25`) giữ nguyên ở phase này (phase 5 thay bằng toggle runtime, cùng hook). Lý do: better-auth không bật
`requireEmailVerification` (`auth.ts:21-27`), `create-user.ts:21` đặt `emailVerified: false` → ai đăng ký trước email
admin chưa có tài khoản sẽ thành admin.

**Mount** — `apps/api/src/routes/admin.ts` export `adminApi()` = `new Hono<AppEnv>()` + `use("*", requireUser)` +
`use("*", requireAdmin)` + `route("/", adminSettingsRoutes)`. `app.ts:44` thêm `app.route("/api/admin", adminApi())`
**trước** `app.route("/api", userApi())`.
<!-- red-team -->
`apps/api/test/tenant-isolation.test.ts:270-277` `userRoutes()` quét `app.routes` của **cả** `createApp()` → thêm
`r.path.startsWith("/api/admin/")` vào bộ lọc, comment "route admin xuyên user có chủ đích — kiểm ở
admin-access.test.ts"; bỏ kỳ vọng `PUT /api/settings/pipeline` ở `:287`.

**Dữ liệu** — `packages/db/src/schema/system-settings.ts` (export ở `schema/index.ts`), migration **0021 `system_settings`**:
```
system_settings (singleton)
  id smallint PK default 1, CHECK (id = 1)
  pipeline jsonb not null default '{}'         -- Partial<PipelineSettings>, đọc qua resolvePipelineSettings
  user_daily_usd numeric null                  -- null = theo env USER_DAILY_USD                (phase 5)
  global_daily_usd numeric null                -- null = theo env GLOBAL_DAILY_USD              (phase 5)
  signup_enabled boolean null                  -- null = theo env SIGNUP_ENABLED                (phase 5)
  updated_at timestamptz not null default now()
```
<!-- red-team --> 3 cột slot (`ocr_model_id`, `translate_model_id`, `proofread_model_id` FK `ai_models`) thêm ở 0022
(phase 2) vì FK cần bảng `ai_models`. `user_settings` giữ nguyên (ngừng đọc/ghi; drop ở migration sau — ngoài plan).

<!-- red-team -->
**Chuyển pipeline `user_settings` → `system_settings`** — viết thêm cuối `0021_system_settings.sql` (sau phần
drizzle-kit sinh, ngăn bằng `--> statement-breakpoint`):
```sql
INSERT INTO "system_settings" ("id", "pipeline")
SELECT 1, "pipeline" FROM "user_settings" ORDER BY "updated_at" DESC LIMIT 1
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "system_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
```
Quy tắc: hàng `user_settings` có `updated_at` mới nhất (thực tế chỉ owner chỉnh); không có → mặc định `{}`. Chạy 1 lần
cùng migration, không phụ thuộc `ADMIN_EMAILS`, không code boot. Đường đọc thiếu hàng (DB test reset) → mặc định.

`apps/api/src/lib/system-settings.ts`: `readSystemSettings(t)` (1 query PK, thiếu → mặc định), `systemPipeline(t)`
(= `resolvePipelineSettings(row.pipeline)`), `saveSystemPipeline(t, p)` (upsert `ON CONFLICT (id) DO UPDATE`).

**Pipeline chung** — `apps/api/src/jobs/enqueue.ts:218` `pipelineSettingsOf(tx, userId)` → `systemPipeline(tx)` (bỏ
tham số user). Call site (đủ 7): `enqueue.ts:233` (`prepareUsesLlm`), `:242` (`enqueuePrepare`), `:336`
(`enqueueReinpaint`), `:374` (`enqueueOcrRegion`), `:441` (`enqueueProofread`, tier vẫn đọc từ pipeline hệ thống tới
phase 4), `:493` (`createIngestedPages`), `apps/api/src/jobs/translate-chain.ts:313` (`retryFailedPages`).
`routes/me.ts:36` (PUT) chuyển sang `routes/admin-settings.ts`; `me.ts:17` bỏ `find(userSettings)`, thêm `is_admin`.

**Web**
- `apps/web/src/lib/api.ts:63` `Me`: thêm `is_admin`, bỏ `settings`.
- `apps/web/src/app/app-shell.tsx:84-99` menu avatar như Requirements (dòng hạn mức dùng `usd()`; giữ
  `data-testid="quota-line"`).
- `apps/web/src/app/router.tsx:117` `settingsRoute.validateSearch` → `{ section?: AdminSection }`; thêm `fontsRoute`
  (`path: "fonts"`, dưới `shellRoute`).
- `apps/web/src/features/admin/admin-sections.ts` (thuần, có test): danh sách mục `{id, label, group}` + `parseSection()`
  (lạ → mục đầu). Phase 1 chỉ `pipeline`; phase 2/5/6/7 thêm `providers`, `tasks`, `limits`, `users`, `fonts`.
- `apps/web/src/features/admin/admin-layout.tsx` + `admin.css`: nav trái (nhóm "AI", "Hệ thống") dạng link
  `?section=`, panel phải; token theo `docs/design-guidelines.md` (không gradient, bo ≤ 4px, 1 màu nhấn; mục đang chọn =
  chữ `--c-accent-hover` + nền `--c-accent-weak`). `!me.is_admin` → `<Navigate to="/" replace />`.
- `apps/web/src/routes/settings.tsx` → render `AdminLayout`; `apps/web/src/routes/fonts.tsx` → trang "Font của tôi" bọc
  `FontSettings`.
- `apps/web/src/features/pipeline/pipeline-settings.tsx:86` PUT → `/api/admin/settings/pipeline`; giá trị đầu đọc
  `GET /api/admin/settings` (query key `["admin","settings"]`); <!-- red-team --> `:87` invalidate
  `["admin","settings"]` (thay `["me"]`).

**Data flow**: admin PUT pipeline → `system_settings.pipeline` → enqueue bất kỳ user đọc `systemPipeline(tx)` → snapshot
vào payload như cũ (`page.prepare.pipeline`, `reinpaint.inpaint`, `ocr_region.ocr_engine`) → worker không đổi.

## Related Code Files

- Create:
  - `packages/db/src/schema/system-settings.ts`
  - `packages/db/migrations/0021_system_settings.sql` (+ `meta/0021_snapshot.json`, `_journal.json` do drizzle-kit sinh)
  - `packages/db/migrations-down/0021_system_settings.down.sql` (`DROP TABLE system_settings;`)
  - `packages/db/test/system-settings-migration.test.ts`
  - `apps/api/src/middleware/admin.ts`, `apps/api/src/lib/system-settings.ts`
  - `apps/api/src/routes/admin.ts`, `apps/api/src/routes/admin-settings.ts`
  - `apps/api/test/admin-access.test.ts`
  - `apps/web/src/features/admin/admin-sections.ts`, `admin-sections.test.ts`, `admin-layout.tsx`, `admin.css`, `api.ts`
  - `apps/web/src/routes/fonts.tsx`
  - `apps/web/e2e/admin-settings.spec.ts`
- Modify:
  - `packages/db/src/schema/index.ts`
  - `apps/api/src/env.ts`, `apps/api/src/auth.ts`, `apps/api/src/app.ts`, `apps/api/src/routes/me.ts`,
    `apps/api/src/jobs/enqueue.ts`, `apps/api/src/jobs/translate-chain.ts`
  - `apps/api/vitest.config.ts` (env `ADMIN_EMAILS: ""`)
  - <!-- red-team --> `apps/api/test/helpers.ts` (`seedAdmin(label)` = `seedUser` + thêm email vào `env.ADMIN_EMAILS`),
    `apps/api/test/isolate-queue.ts` (`beforeAll` xoá hàng `system_settings`; `afterEach` khôi phục
    `env.ADMIN_EMAILS` về bản sao lúc đầu file — state cấp process)
  - `apps/api/test/pipeline-settings.test.ts`, `apps/api/test/tenant-isolation.test.ts:270-277,287`,
    <!-- red-team --> `apps/api/test/translate-chain.test.ts:119` (PUT route bị xoá → `/api/admin/settings/pipeline` với
    `seedAdmin`), `apps/api/test/signup.test.ts` (ca email admin)
  - `apps/web/src/lib/api.ts`, `apps/web/src/app/app-shell.tsx`, `apps/web/src/app/router.tsx`,
    `apps/web/src/routes/settings.tsx`, `apps/web/src/features/pipeline/pipeline-settings.tsx`
  - `apps/web/e2e/env.ts` (`ADMIN_EMAILS: E2E_OWNER.email`), `apps/web/e2e/pipeline-settings.spec.ts`,
    <!-- red-team --> `apps/web/e2e/fonts.spec.ts:26-29,57,111` (link "Cài đặt chung" → "Font của tôi", heading, URL
    `/fonts`), `apps/web/e2e/routes.spec.ts:42`, `apps/web/e2e/seed.ts` (seed thêm 1 user thường — e2e không đăng ký
    qua UI để khỏi chạm rate limit)
  - `.env.example` (`ADMIN_EMAILS=`), `docs/job-queue-worker.md` mục "Cài đặt pipeline" (:254), `docs/deployment-guide.md`
    mục 2 (`ADMIN_EMAILS`; admin chỉ tạo bằng `pnpm create-user`), `docs/design-guidelines.md` (mục Cài đặt admin)
- Delete: không (route `PUT /api/settings/pipeline` xoá trong `me.ts`).

## Implementation Steps

### Tests Before (khoá hành vi hiện tại, phải xanh trên code cũ)
1. `apps/api/test/pipeline-settings.test.ts`: thêm ca "mặc định: input_rev `page.prepare` = `prepareInputRev(sha,
   settingsRev, PIPELINE_VERSION)` không trộn options" và "snapshot payload prepare/reinpaint/ocr_region với cài đặt khác
   mặc định" nếu ca :71/:80 chưa khoá đủ 3 loại payload (đọc lại trước khi thêm).
2. `packages/shared/test/pipeline-settings.test.ts`: khoá `resolvePipelineSettings` với key lạ / thiếu / engine sai ngôn
   ngữ (đầu vào jsonb copy từ `user_settings`).
3. `apps/api/test/user-quota.test.ts:70`: khoá shape `quota` của `/api/me`.
4. `apps/api/test/signup.test.ts:26-48`: chạy xanh (khoá phản hồi 400 khi tắt, tạo được khi bật) trước khi thêm hook.
5. Gate xanh → commit `test(api): lock pipeline snapshot before moving settings to system scope`.

### Refactor / Implement
6. Schema `system_settings` → `pnpm --filter @mtl/db generate --name system_settings`; CHECK `id = 1` (`check()`);
   nối SQL chuyển dữ liệu; file down. `pnpm db:migrate`.
7. `env.ts` `ADMIN_EMAILS`; `middleware/admin.ts`; hook chặn email admin trong `auth.ts`; `lib/system-settings.ts`.
8. Thay `pipelineSettingsOf` bằng `systemPipeline` ở 7 call site; xoá import `userSettings` khỏi `enqueue.ts:17`.
9. `routes/admin-settings.ts` (GET settings, PUT pipeline — `parseJson(c, z.object({ pipeline: PipelineSettings }))`),
   `routes/admin.ts`, mount ở `app.ts`; `me.ts` thêm `is_admin`, bỏ PUT + `settings`.
10. Web: `Me`, router (`section`, `/fonts`), `admin-sections.ts`, `AdminLayout`, menu avatar, `routes/fonts.tsx`,
    pipeline form đổi endpoint + nguồn giá trị + invalidate.
11. Docs + `.env.example`.

### Tests After
12. `admin-access.test.ts`: (a) chưa đăng nhập `GET /api/admin/settings` → 401; (b) user thường → 403 cho **mọi**
    route của `adminApi().routes` (quét router thật) → route admin phase sau tự được kiểm; (c) `ADMIN_EMAILS` chứa
    `"  Admin@Example.COM "` → user `admin@example.com` là admin; (d) `/api/me` `is_admin` true/false; (e) sau mỗi ca
    `env.ADMIN_EMAILS` về giá trị cũ (ca kế không thấy admin của ca trước).
13. `signup.test.ts`: đăng ký bật + email ∈ `ADMIN_EMAILS` (cả dạng viết hoa/khoảng trắng) → 400
    `EMAIL_PASSWORD_SIGN_UP_DISABLED`, không tạo dòng `user`; email thường vẫn đăng ký được; `createUser()` với email
    admin vẫn tạo được.
14. `packages/db/test/system-settings-migration.test.ts` (mẫu `single-user-migration.test.ts`: dựng DB tới 0020, seed
    2 user có `user_settings` khác `updated_at`, chạy tiếp): `system_settings.pipeline` = của hàng mới nhất; DB không có
    `user_settings` → hàng `{}`.
15. `pipeline-settings.test.ts`: admin PUT `/api/admin/settings/pipeline` → job của user B snapshot cài đặt đó;
    `PUT /api/settings/pipeline` → 404; user thường PUT admin → 403; ca Tests Before vẫn xanh. `translate-chain.test.ts`
    xanh với route mới.
16. Web unit `admin-sections.test.ts`; e2e `admin-settings.spec.ts`: owner (admin) thấy link Cài đặt + mục Pipeline; user
    thường (seed) không thấy link, `/settings` → `/`, `/fonts` mở được. `pipeline-settings.spec.ts` dùng `?section=pipeline`.

### Regression Gate
```bash
pnpm infra:up
pnpm typecheck && pnpm lint
pnpm --filter @mtl/db test && pnpm --filter @mtl/shared test && pnpm --filter @mtl/api test && pnpm --filter @mtl/web test
pnpm --filter @mtl/db generate   # "No schema changes" sau khi đã generate 0021
grep -rn "/api/settings/pipeline\|Cài đặt chung" apps   # chỉ còn chuỗi có chủ đích (không còn route/link cũ)
pnpm --filter @mtl/web e2e admin-settings pipeline-settings fonts routes
```

## Success Criteria

- [x] `/api/admin/*` 401/403 đúng cho mọi route (test quét router); `/api/me.is_admin` đúng, chuẩn hoá email.
- [x] Đăng ký bằng email admin luôn bị từ chối; `create-user` vẫn tạo được admin.
- [x] Job mọi user snapshot pipeline hệ thống; mặc định input_rev không đổi (ca Tests Before xanh).
- [x] Migration 0021 copy đúng hàng `user_settings` mới nhất; không có → mặc định.
- [x] Web: user thường bị redirect khỏi `/settings`, `/fonts` dùng được, menu avatar đúng.
- [x] Gate xanh, `drizzle-kit generate` không còn thay đổi.

**Kết quả (2026-11-04)**: xong, review 8.5/10 (0 Critical/High). Báo cáo:
`plans/reports/from-fullstack-developer-261104-1337-phase-01-admin-foundation-report.md`,
`plans/reports/from-code-reviewer-261104-1345-phase-01-03-review-report.md`. Tests Before không thêm ca mới (test sẵn có đã khoá đủ).
Còn lại: dev local cần `ADMIN_EMAILS=<email>` trong `.env` (gitignored) mới thấy Cài đặt; các dòng cũ của `docs/job-queue-worker.md`
(PUT `/api/settings/pipeline`, pipeline per-user) chưa: kiểm lại lúc merge docs.

## Risk Assessment

| Rủi ro | Khả năng × Tác động | Giảm thiểu |
|---|---|---|
| <!-- red-team --> Kẻ lạ đăng ký email admin chưa có tài khoản → thành admin | TB × Cao | Hook chặn mọi email `ADMIN_EMAILS` ở sign-up (test); admin chỉ qua `create-user`; không có endpoint đổi email (`changeEmail` không bật) |
| User khác mất cài đặt pipeline riêng | Chắc × Thấp | Chấp nhận theo D1 |
| Hàng `user_settings` mới nhất không phải của owner | Thấp × Thấp | Owner chỉnh lại 1 form; ghi checklist deploy "kiểm mục Pipeline sau deploy" |
| `system_settings` / `env.ADMIN_EMAILS` là state toàn cục giữa test | Cao × TB | `isolate-queue.ts` xoá hàng + khôi phục env sau mỗi ca; `fileParallelism: false` đã có |
| Web cũ (cache) gọi `PUT /api/settings/pipeline` → 404 | Thấp × Thấp | Web + API deploy cùng lúc |

Rollback: revert code; bảng `system_settings` additive (down file). `user_settings` không bị xoá nên bản cũ đọc lại được
(thay đổi pipeline làm trên bản mới không quay về bản cũ — ghi docs).
