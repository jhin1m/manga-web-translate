---
phase: 2
title: "Đăng ký mở + hạn mức mỗi user"
status: completed
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 2: Đăng ký mở + hạn mức mỗi user

## Overview
Mở đăng ký email/mật khẩu theo cờ `SIGNUP_ENABLED` (D2/D5) và hạn mức chi phí theo ngày cho từng user
`USER_DAILY_USD`, để một tài khoản không đốt ngân sách toàn cục của người khác.

## Requirements
- Functional:
  - `SIGNUP_ENABLED=true` → `POST /api/auth/sign-up/email` tạo user; `false` → bị chặn **trước** khi tra email (không
    lộ email đã tồn tại). Script `create-user` luôn tạo được.
  - User đã tiêu ≥ `USER_DAILY_USD` hôm nay (UTC, cùng cửa sổ `budget.ts`; tính **mọi** chi phí của user: token LLM +
    GPU) → endpoint tạo job LLM trả 402 `{ error: "quota_exceeded", spent_usd, limit_usd, resets_at }`; job LLM
    chờ/đang chạy của user đó **fail `quota_exceeded`**; job không-LLM của user đó chỉ chạy trên worker `kind='mac'`.
  - User khác không bị ảnh hưởng. `GET /api/me` thêm `quota: { spent_usd, limit_usd | null, resets_at }`.
- Non-functional: cấu hình an toàn mặc định (đăng ký tắt nếu không khai báo); không vòng pause/resume giữa process.

## Architecture

<!-- Red Team: mặc định mở khi quên NODE_ENV; cổng trong databaseHooks lộ email — 2026-10-24 -->
**Env** (`apps/api/src/env.ts`)
- `SIGNUP_ENABLED` boolean, **mặc định `false`** mọi môi trường (`.env.example` dev đặt `true`).
- `USER_DAILY_USD` số ≥ 0 (0 = chặn mọi job LLM; không đặt = không giới hạn).
- `SIGNUP_ENABLED=true` → bắt buộc `GLOBAL_DAILY_USD` + `USER_DAILY_USD`, **bất kể `NODE_ENV`** (`NODE_ENV` mặc định
  `development` — `env.ts:12`; chỉ unit systemd đặt production — `infra/systemd/mtl-api.service:14`).

**Cổng đăng ký** (`auth.ts`)
- `emailAndPassword: { enabled: true, minPasswordLength: 10, disableSignUp: !env.SIGNUP_ENABLED, autoSignIn: false }`
  — `disableSignUp` chặn trước bước tra email/hash (`better-auth/dist/api/routes/sign-up.mjs:145` vs `:189-213`);
  `autoSignIn: false` để email trùng không trả 422 riêng (kiểm bằng test; web đăng nhập ngay sau đăng ký).
- `rateLimit`: bật khi `SIGNUP_ENABLED` (mặc định better-auth chỉ bật ở production — `create-context.mjs:172`),
  `customRules["/sign-up/email"] = { window: 3600, max: 5 }` (mặc định 3/10s ≈ 26k tài khoản/IP/ngày); lưu memory
  (1 process API). IP từ `x-real-ip` như cũ.

<!-- Red Team: quota bỏ qua chi phí GPU; pause/resume đóng băng chương, lệch env giữa process, limit=0 lọt — 2026-10-24 -->
**Hạn mức** — `apps/api/src/billing/user-quota.ts` (cạnh `budget.ts`):
- `overQuotaSql(userIdCol)`: `limit === 0` → `true`; không đặt → `false`; còn lại `coalesce((select sum(cost_usd)
  from usage_ledger where user_id = <col> and created_at >= dayStart), 0) >= limit` — tính theo từng job nên user
  chưa có ledger hôm nay vẫn đúng (không dùng `GROUP BY … HAVING`).
- `userQuotaStatus(t, userId)` cho `GET /api/me` và 402.
- **Không pause — fail.** Job LLM của user vượt hạn mức → `failed` với lỗi `quota_exceeded` (không tính attempt, không
  tính tiền), giữ kết quả trang đã ghi như nhánh `paused_budget` hiện có. Lý do: `paused_budget` thuộc
  `ACTIVE_JOB_STATUSES` (`packages/shared/src/job.ts:45`) → chương kẹt `processing`, editor chỉ xem, skip trang 409
  tới 7h sáng; nhãn "hết ngân sách" sai nghĩa; resume ở `mtl-jobs` vs pause ở `mtl-api` lệch env sẽ lặp 30s/lần.
  Không đụng `paused_budget` / `resumeBudgetPaused` / `scripts/budget-resume.ts` (vẫn chỉ cho ngân sách toàn cục).
- Điểm áp dụng:
  1. Endpoint người dùng bấm tạo job LLM → `assertQuota` 402: `routes/chapters.ts:264,315` (commit/ingest khi
     pipeline OCR là LLM), `:399` translate-prepared, `:406` retry-failed, `:418` translate,
     `routes/page-state.ts:246` ocr-region (engine LLM), `routes/proofread.ts:18`. Không đặt trong `insertJob`
     (job nối tiếp ingest → prepare tạo ở worker complete — `queue.ts:460` → `enqueue.ts:489`).
  2. Claim (`jobs/queue.ts` cạnh kiểm `budgetStatus` ~`:93`): trước khi chọn, fail job LLM `queued` của user vượt
     hạn mức; câu chọn loại job LLM của họ; với token `kind='modal'` loại thêm **mọi** job của user vượt hạn mức
     (job không-LLM chỉ Mac — chi phí $0, `billing/prices.ts` `mac: 0` — hoặc chờ sang ngày).
  3. Runner `mtl-jobs` tick: cùng hàm fail job LLM chờ của user vượt hạn mức (khi chỉ có Modal, job không bị claim).
  4. Heartbeat (`queue.ts:210-219`, cạnh kiểm ngân sách toàn cục): job LLM đang chạy của user vượt → dừng +
     `quota_exceeded`. Vượt tối đa ≈ (số worker đang chạy × chi phí tới heartbeat kế), không phải cả chương.
  5. Dispatcher: predicate tuổi job dùng chung với (2) — không bật Modal cho job của user vượt hạn mức (phase 1).

## Related Code Files
- Create: `apps/api/src/billing/user-quota.ts`, `apps/api/test/user-quota.test.ts`, `apps/api/test/signup.test.ts`.
- Modify: `apps/api/src/{env,auth}.ts`, `apps/api/src/jobs/{queue,runner,dispatcher}.ts`, `routes/chapters.ts`,
  `routes/page-state.ts`, `routes/proofread.ts`, `routes/me.ts`, `.env.example`, `packages/shared` (mã lỗi
  `quota_exceeded` nếu job error code được liệt kê ở đó).

## Implementation Steps
1. Env + kiểm khi `SIGNUP_ENABLED=true`; `.env.example`.
2. `disableSignUp`/`autoSignIn`/`rateLimit` trong `auth.ts`.
3. `user-quota.ts`; 402 ở 7 endpoint; `quota` trong `/api/me`.
4. Claim / runner / heartbeat / dispatcher dùng chung predicate.
5. Test:
   - Đăng ký: bật → 200; tắt → bị chặn với cả email mới **và email đã tồn tại** (cùng mã, không lộ); bật + email
     trùng → không 422 riêng; rate limit `/sign-up/email` thứ 6 trong 1 giờ → 429; script tạo được khi tắt.
   - Env: `SIGNUP_ENABLED=true` thiếu `USER_DAILY_USD` → không khởi động (cả khi `NODE_ENV` không đặt).
   - Hạn mức: 402 khi vượt; `USER_DAILY_USD=0` với ledger rỗng → chặn; job LLM chờ → `failed quota_exceeded`, chương
     không kẹt `processing`; job không-LLM của user vượt: token mac claim được, token modal không; user B (A vượt do chi
     phí GPU) vẫn claim job LLM bình thường; heartbeat dừng job đang chạy; job nối tiếp từ worker complete không lỗi.
6. Gate: typecheck, lint, test api, pytest.

## Success Criteria
- [x] Đăng ký: bật/tắt/email trùng/rate limit đúng như trên; không lộ email tồn tại.
- [x] Vượt hạn mức (kể cả chỉ do GPU): endpoint LLM 402, job LLM fail `quota_exceeded`, Modal không chạy job của họ,
      user khác không bị ảnh hưởng; limit 0 chặn tất cả.
- [~] Không còn trạng thái nào khiến chương kẹt vì hạn mức user — job LLM: đạt; job không-LLM của user vượt hạn mức khi
      không có Mac sống vẫn chờ tới ngày mới (đã chấp nhận ở Risk; review H1 — xem reports/).

## Risk Assessment
- **Nhiều tài khoản rác nhân hạn mức + đầy dung lượng MinIO** (không có hạn mức lưu trữ/user) — ngân sách toàn cục
  vẫn là trần; checklist deploy **bắt buộc `SIGNUP_ENABLED=false` ở production** tới Phase 8 (xác thực email, hạn mức
  dung lượng).
- **Hành vi `autoSignIn: false` với email trùng trong better-auth 1.7.11** chưa chắc trả phản hồi chung → test quyết;
  nếu vẫn 422 thì chặn bằng `hooks.before` (`createAuthMiddleware`, path `/sign-up/email`) trả phản hồi chung.
- **Job không-LLM của user vượt hạn mức khi không có Mac** chờ tới ngày mới — chấp nhận, UI hiện "đang chờ".
