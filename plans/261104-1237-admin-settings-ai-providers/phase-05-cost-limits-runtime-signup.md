---
phase: 5
title: "Hạn mức + đăng ký runtime"
status: completed
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 5: Hạn mức + đăng ký runtime

## Overview

Admin chỉnh `user_daily_usd`, `global_daily_usd`, bật/tắt đăng ký trên UI, có hiệu lực ngay không restart (D7, T1, T17).
Cột đã có trong `system_settings` (migration 0021) → **không migration**. `null` = theo env như cũ. Không có trần trên
(red team #15 bị bác: admin được tin, `GLOBAL_MONTHLY_USD` env vẫn chặn).

## Requirements

- Functional:
  - Mục **Hệ thống › Hạn mức & đăng ký**: 2 ô USD (trống = theo env, placeholder = giá trị env), toggle "Cho phép đăng
    ký" (giữ theo D7), chi tiêu hôm nay toàn hệ thống + người dùng chi nhiều nhất hôm nay. Toggle chỉ bật được khi đủ 2
    hạn mức hiệu lực.
  - `GET /api/admin/settings` thêm `limits: { user_daily_usd, global_daily_usd, signup_enabled }` (giá trị lưu, `null` =
    env) + `effective` (sau fallback) + `today: { global_spent_usd, max_user_spent_usd }`. `PUT /api/admin/settings/limits`
    lưu cả bộ; trạng thái sau lưu có đăng ký bật mà thiếu 1 hạn mức hiệu lực → 409 `limits_required` (thông điệp như
    `env.ts:90`).
  <!-- red-team -->
  - Hạ hạn mức xuống **dưới số đã chi hôm nay** (user: so `max_user_spent_usd`; toàn cục: so `global_spent_usd`) → UI hiện
    hộp xác nhận nêu hậu quả; API từ chối 409 `confirm_required` (kèm 2 số + số job LLM đang chờ/chạy bị ảnh hưởng) nếu body
    thiếu `confirm: true`. Câu cảnh báo:
    - user: "Hạn mức mới $X thấp hơn số k người dùng đã chi hôm nay (cao nhất $Y). Ngay khi lưu: N job AI đang chờ của họ
      bị huỷ (lỗi `quota_exceeded`), job đang chạy dừng ở nhịp kế; nâng hạn mức lại **không** tự chạy lại — họ phải bấm
      "Chạy lại trang lỗi" (tốn tiền AI lại phần đã chạy dở). Đặt lại về 0h UTC."
    - toàn cục: "Ngân sách ngày mới $X thấp hơn tổng đã chi hôm nay $Y. Mọi job AI dừng (`paused_budget`) và tự chạy lại khi
      sang ngày UTC mới hoặc khi nâng ngưỡng."
  - Hạn mức hiệu lực = DB ?? env, áp ở mọi chỗ hiện đọc env: endpoint 402, claim, heartbeat, runner, dispatcher, chuỗi dịch,
    `/api/me.quota`, câu lỗi `quota_exceeded`.
  - Đăng ký: `signup_enabled` DB ?? `env.SIGNUP_ENABLED`; tắt → `POST /api/auth/sign-up/email` 400
    `EMAIL_PASSWORD_SIGN_UP_DISABLED` ngay (giữ mã → `apps/web/src/routes/login.tsx:16` không đổi). Email thuộc
    `ADMIN_EMAILS` vẫn luôn bị chặn (hook phase 1). `pnpm create-user` vẫn tạo được.
  <!-- red-team -->
  - Rate limit: bật ở dev/production (`/sign-up/email` 5/giờ/IP, `/get-session` không giới hạn, luật mặc định better-auth
    cho `/sign-in*` 3/10s); **tắt khi `NODE_ENV=test`** (vitest) — test cần thì bật qua tham số `createAuth` + IP riêng
    mỗi request như `signup.test.ts` đang làm.
  <!-- red-team -->
  - `GET /healthz` thêm `signup: "open" | "closed"` (trạng thái hiệu lực; không phải dữ liệu người dùng). `infra/smoke.sh`
    kiểm theo trạng thái thật, **không tạo user**.
- Non-functional: thêm tối đa 1 truy vấn PK `system_settings` cho mỗi lần đánh giá; `GLOBAL_MONTHLY_USD` vẫn chỉ env.

## Architecture

**Hiệu lực** — `apps/api/src/lib/system-settings.ts`:
- `effectiveLimits(t)` → `{ userDailyUsd, globalDailyUsd, signupEnabled }` (DB ?? env, đọc env lúc gọi).
- `userDailyLimitSql()` = ``sql`coalesce((select user_daily_usd from system_settings where id = 1), ${env.USER_DAILY_USD ?? null}::numeric)` ``
  — dựng mỗi lần gọi (giữ hành vi test đổi env lúc chạy).
- `todaySpend(t)` → `{ global_spent_usd, max_user_spent_usd, users_over(limit) }` (1 query `usage_ledger` từ đầu ngày UTC,
  cùng `dayStart` như `user-quota.ts:19`) + đếm job LLM active bị ảnh hưởng.

**Quota** — `apps/api/src/billing/user-quota.ts`:
- `overQuotaSql(userIdCol)` (`:27`) giữ chữ ký đồng bộ; logic vào SQL: `L is not null and (L = 0 or spent >= L)` với
  `L = userDailyLimitSql()` → `claimableSql` (`:37`) và 2 caller (`jobs/queue.ts:113`, `jobs/dispatcher.ts:156`) không đổi.
- `userQuotaStatus(t, userId, limit?)` (`:40`): không truyền → `effectiveLimits(t).userDailyUsd`.
- `assertQuota` (`:59`) bỏ early-return theo env; `quotaFailMessage` (`:72`) → `async (t)`; `lockQueuedOverQuotaLlmJobs`
  (`:75`) bỏ early-return env.
- `jobs/queue.ts:63` → `await quotaFailMessage(t)`; `:230-234` bỏ điều kiện `env.USER_DAILY_USD !== undefined`. Caller qua
  `userQuotaStatus` không đổi: `translate-chain.ts:197`, `routes/chapters.ts:304`, `routes/me.ts:21`. Caller `assertQuota`
  không đổi chữ ký: `routes/page-state.ts:334`, `routes/proofread.ts:20`, `routes/chapters.ts:306,404,414,429`.

**Ngân sách** — `apps/api/src/billing/budget.ts:39` `env.GLOBAL_DAILY_USD` → `effectiveLimits(t).globalDailyUsd`;
monthly giữ env. Caller (`jobs/runner.ts:31`, `dispatcher.ts:150`, `queue.ts:91,223`, `scripts/budget-resume.ts:21`) không
đổi chữ ký.

**Đăng ký** — `apps/api/src/auth.ts`:
- `createAuth({ isSignupEnabled = defaultIsSignupEnabled, rateLimitEnabled = env.NODE_ENV !== "test" })` (thay
  `signupEnabled: boolean`, `:7`); `defaultIsSignupEnabled = async () => { const l = await effectiveLimits(db); return
  l.signupEnabled && l.userDailyUsd != null && l.globalDailyUsd != null }`.
- Bỏ `disableSignUp` (`:25`); mở rộng `hooks.before` của phase 1: `/sign-up/email` → email admin **hoặc**
  `!(await isSignupEnabled())` → `APIError("BAD_REQUEST", { code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" })` (trước handler,
  không lộ email tồn tại — research mục 1).
- `rateLimit` (`:33`) = `{ enabled: rateLimitEnabled, storage: "memory", customRules: { "/sign-up/email": { window:
  3600, max: 5 }, "/get-session": false } }`. Bộ đếm `memory` là `Map` cấp module dùng chung mọi instance (better-auth
  `rate-limiter/index.mjs:6`) → test bật rate limit phải dùng IP riêng.
- `env.ts:89` guard `SIGNUP_ENABLED` cần 2 hạn mức env giữ nguyên.

<!-- red-team -->
**Smoke / deploy** — `apps/api/src/lib/health.ts` thêm `signup` vào kết quả `checkHealth()` (đọc `isSignupEnabled`).
`infra/smoke.sh:16-24`: đọc `signup` từ `/healthz`; POST sign-up với email `smoke-…@invalid.example` + mật khẩu **ngắn**
(`"x"`) → kỳ vọng 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` khi `closed`, 400 `PASSWORD_TOO_SHORT` khi `open` (không tạo user
trong cả hai; kiểm thứ tự validate trong `better-auth/dist/api/routes/sign-up.mjs` lúc implement); `open` → `log` cảnh
báo "đăng ký công khai đang mở (chưa xác thực email)". `infra/deploy.sh` không đổi (vẫn gọi smoke, rollback khi hỏng) —
kiểm lại `deploy.sh:42,50,77-84`.

**Routes/Web** — `routes/admin-settings.ts` thêm `PUT /settings/limits` (zod: số ≥ 0 hoặc null, boolean hoặc null,
`confirm?: boolean`) + `limits/effective/today` trong GET. Web `features/admin/limits-section.tsx` + `limits-model.ts`
(thuần: `canEnableSignup`, `needsConfirm(new, today)`, câu cảnh báo), mục `limits` trong `admin-sections.ts`.
`/api/me.quota.limit_usd` = hiệu lực → menu avatar (phase 1) tự đúng.

**Data flow**: admin PUT limits (± confirm) → `system_settings` → lần đánh giá kế (claim/heartbeat/endpoint/hook sign-up/
healthz) đọc ngay → hiệu lực ngay, không restart `mtl-api`/`mtl-jobs`.

## Related Code Files

- Create: `apps/api/test/admin-limits.test.ts`, `apps/web/src/features/admin/limits-section.tsx`,
  `apps/web/src/features/admin/limits-model.ts`, `apps/web/src/features/admin/limits-model.test.ts`
- Modify:
  - `apps/api/src/lib/system-settings.ts`, `apps/api/src/billing/user-quota.ts`, `apps/api/src/billing/budget.ts`,
    `apps/api/src/jobs/queue.ts`, `apps/api/src/auth.ts`, `apps/api/src/routes/admin-settings.ts`, `apps/api/src/lib/health.ts`
  - `apps/api/test/signup.test.ts` (`createAuth({ signupEnabled })` → `isSignupEnabled` + `rateLimitEnabled: true` ở ca rate
    limit), `apps/api/test/user-quota.test.ts`, `apps/api/test/budget.test.ts`
  - `infra/smoke.sh`
  - `apps/web/src/features/admin/admin-sections.ts`, `api.ts`; `apps/web/e2e/signup.spec.ts`, `admin-settings.spec.ts`
  - `scripts/budget-resume.ts:5` (comment: ngưỡng ngày đổi được trên UI), `docs/job-queue-worker.md:314`,
    `docs/deployment-guide.md` (mục 2 `SIGNUP_ENABLED`/`USER_DAILY_USD` = mặc định khi DB trống; `:54,152,160` chính sách
    đăng ký production: env là mặc định, admin bật trên UI = chấp nhận chưa xác thực email; smoke mới kiểm theo trạng thái;
    mục 6)
- Delete: không.

## Implementation Steps

### Tests Before
1. `apps/api/test/user-quota.test.ts` (`:70`, `:100`, `:118`, `:138`, `:150`, `:177`) và `budget.test.ts` (`:60`, `:76`,
   `:98`) xanh — hợp đồng không đổi khi DB `null`.
2. `apps/api/test/signup.test.ts` (`:26`, `:40`, `:91`) xanh; thêm `user-quota.test.ts`: `quotaFailMessage` chứa
   `$<limit>/ngày` theo env.
3. <!-- red-team --> Chạy `pnpm --filter @mtl/api test` với `rateLimit.enabled: true` tạm thời (không commit) để xác nhận
   luật `/sign-in*` 3/10s làm đỏ các file nhiều `signIn` (`chapters.test.ts`, `queue.test.ts`, `user-quota.test.ts`) → lý
   do cho `rateLimitEnabled = NODE_ENV !== "test"`.
4. `bash -n infra/smoke.sh` + chạy smoke trên API dev (`SIGNUP_ENABLED=false`) xanh.

### Refactor / Implement
5. `effectiveLimits` + `userDailyLimitSql` + `todaySpend` → user-quota → budget → queue.
6. `auth.ts` toggle runtime + rate limit có tham số; `health.ts` `signup`; `smoke.sh`.
7. Route limits (+ `confirm`) + web mục Hạn mức & đăng ký; docs.

### Tests After
8. `admin-limits.test.ts`:
   - DB `user_daily_usd = 1` (env undefined) → endpoint LLM 402 khi vượt, claim fail job `quota_exceeded`, heartbeat dừng —
     đặt `null` → theo env ngay, không dựng lại app.
   - DB `user_daily_usd = 0` (kèm `confirm`) → chặn hết; `global_daily_usd = 0` → `paused_budget` ở claim.
   - PUT hạ `user_daily_usd` dưới `max_user_spent_usd` không `confirm` → 409 `confirm_required` (kèm số job), DB không đổi;
     có `confirm: true` → 200. Tương tự `global_daily_usd`. Nâng hạn mức → không cần xác nhận.
   - Bật đăng ký khi thiếu hạn mức → 409 `limits_required`; đủ (DB hoặc env) → 200; xoá hạn mức khi đang bật → 409.
   - `quotaFailMessage` theo hạn mức DB; `/healthz.signup` đổi theo DB.
9. `signup.test.ts`: `createAuth()` mặc định đọc DB: bật + 2 hạn mức → 200; đổi `false` → cùng instance 400 ngay; email
   mới / đã có cùng phản hồi; `rateLimitEnabled: true` + 6 lần/IP → 429 cả khi đăng ký tắt; email admin → 400 dù bật;
   `createUser()` vẫn tạo khi tắt. Bộ API test mặc định (rate limit tắt) xanh.
10. Web unit `limits-model.test.ts` (`needsConfirm`, câu cảnh báo có số); e2e `signup.spec.ts`: admin tắt đăng ký trên UI →
    form báo tắt; bật lại → đăng ký được (≤ 2 lần đăng ký/lượt e2e để không chạm 5/giờ).
11. Smoke: `infra/smoke.sh` trên API dev với `signup` closed và open đều xanh, không thêm dòng `user`.

### Regression Gate
```bash
pnpm typecheck && pnpm lint
pnpm --filter @mtl/api test && pnpm --filter @mtl/web test
bash -n infra/smoke.sh && infra/smoke.sh http://127.0.0.1:8787
pnpm --filter @mtl/web e2e signup admin-settings
```

## Success Criteria

- [x] Đổi hạn mức / đăng ký trên UI có hiệu lực ở request kế tiếp, không restart.
- [x] DB `null` → hành vi y như env (test quota/budget cũ xanh không sửa kỳ vọng).
- [x] Hạ dưới chi tiêu hôm nay bắt xác nhận (UI + API), cảnh báo nêu rõ hậu quả.
- [x] Không bật được đăng ký khi thiếu hạn mức hiệu lực; tắt → 400 đúng mã, không lộ email; email admin luôn bị chặn.
- [x] `smoke.sh` đúng ở cả 2 trạng thái, không tạo user; deploy không tự rollback vì đăng ký bật.
- [x] Bộ API test xanh với rate limit tắt ở `NODE_ENV=test`; ca rate limit riêng vẫn kiểm 429.

**Kết quả (2026-11-04)**: xong, review 8/10 (0 Critical/High); fix M1–M3, L1–L8 đã áp. Smoke `infra/smoke.sh` chạy thật trên API :8799
(e2e DB) ở cả closed/open, không tạo user. Lệch: Tests Before bước 3 (bật rate limit tạm cho cả bộ API) — chưa chạy, lý do đã thấy gián tiếp ở e2e;
`needsConfirm` không có ở web (server là nguồn quyết định, UI dựng hộp từ 409 `confirm_required`); `todaySpend` nằm ở `billing/user-quota.ts`.
Ghi nhớ: dev DB `mtl` :5442 cần `pnpm db:migrate`. Báo cáo: `plans/reports/from-fullstack-developer-261104-1446-phase-05-limits-signup-report.md`,
`plans/reports/from-code-reviewer-261104-1506-phase-05-review-report.md`.

## Risk Assessment

| Rủi ro | Khả năng × Tác động | Giảm thiểu |
|---|---|---|
| <!-- red-team --> Admin gõ nhầm hạn mức thấp → fail job hàng loạt | TB × Cao | Xác nhận khi < đã chi hôm nay (UI + 409 API), cảnh báo có số job |
| Subquery `system_settings` trong `overQuotaSql` | Thấp × Thấp | Singleton PK, Postgres gom InitPlan; đo `EXPLAIN` nếu claim chậm |
| Hook sign-up lỗi DB → chặn mọi đăng ký | Thấp × Thấp | Lỗi → 500 (fail-closed: không mở đăng ký khi không đọc được) |
| <!-- red-team --> Rate limit làm test/e2e đỏ (luật mặc định `/sign-in*` 3/10s, bucket chung khi không có IP) | TB × TB | Tắt ở `NODE_ENV=test`; ca rate limit dùng IP riêng; e2e tạo user bằng seed thay vì đăng ký UI; ≤ 2 đăng ký/lượt e2e |
| <!-- red-team --> Đăng ký bật làm `smoke.sh` fail → deploy tự rollback | Cao × Cao (trước khi sửa) | Smoke đọc trạng thái từ `/healthz`, mật khẩu ngắn không tạo user; docs cập nhật |
| Bật đăng ký ở production khi chưa xác thực email | TB × TB | Quyết định của admin (D7); smoke log cảnh báo; email admin bị chặn; hạn mức bắt buộc |
| Admin muốn "không giới hạn" khi env có ngưỡng | TB × Thấp | Không hỗ trợ (`null` = env) — câu hỏi mở |

Rollback: revert code (gồm `smoke.sh`); cột DB giữ nguyên vô hại, hành vi quay về env.
