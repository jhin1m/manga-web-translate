# Phase 5 report: cost limits + runtime sign-up

Status: DONE_WITH_CONCERNS (see Deviations / open questions)

## Files
- api src: `lib/system-settings.ts` (storedLimits, effectiveLimits, isSignupOpen, userDailyLimitSql, saveLimits), `billing/user-quota.ts` (overQuotaSql no param + DB??env SQL, `userQuotaStatus` limit optional, `assertQuota` / `lockQueuedOverQuotaLlmJobs` no env early-return, `quotaFailMessage(t)` async, + `todaySpend`, `llmJobsOverUserLimit`, `activeLlmJobs`), `billing/budget.ts` (daily limit = effective), `jobs/queue.ts`, `auth.ts` (runtime hook, `isSignupEnabled` + `rateLimitEnabled`, `disableSignUp` removed), `lib/health.ts` (`signup`), `routes/admin-settings.ts` (GET adds `limits/effective/env/today`; `PUT /settings/limits`).
- api tests: new `admin-limits.test.ts` (10); `signup.test.ts` adapted + 5 runtime/rate-limit cases; `user-quota.test.ts` +1 (message).
- web: new `features/admin/limits-model.ts` (+test, 7), `limits-section.tsx`; changed `admin-sections.ts` (group "Hệ thống"), `admin-layout.tsx`, `api.ts`. e2e: `signup.spec.ts` +1, `admin-settings.spec.ts` +1.
- infra/docs: `infra/smoke.sh`, `.env.example`, `docs/deployment-guide.md`, `docs/development-setup.md`, `docs/job-queue-worker.md`, `scripts/budget-resume.ts` comment. Phase file criteria ticked, status completed; plan.md phase 5 = Completed.
- No migration (columns already in `system_settings`).

## Behaviour
- Effective = DB ?? env, read per evaluation (1 PK query, or an InitPlan subquery in claim SQL). Existing quota/budget tests pass UNCHANGED (DB null == env).
- Sign-up: `hooks.before` blocks when admin email OR `!isSignupOpen` (enabled AND both effective limits). DB error -> 500 (fail-closed). Admin-email guard always on. Code `EMAIL_PASSWORD_SIGN_UP_DISABLED` kept.
- Rate limit config always passed; `enabled = NODE_ENV !== "test"`.
- `PUT /settings/limits`: whole set; 409 `limits_required`; 409 `confirm_required` {max_user_spent_usd, global_spent_usd, user_over, global_over, user_jobs, global_jobs} unless `confirm: true`. Runs under settings row lock.
- `/healthz.signup`: `open | closed | null` (null only if DB unreadable). smoke.sh reads it; closed -> expects 400 EMAIL_PASSWORD_SIGN_UP_DISABLED, open -> POST password "x" expects 400 PASSWORD_TOO_SHORT + warning log. Verified in better-auth `sign-up.mjs`: order is disableSignUp -> email -> password present -> too-short -> findUserByEmail, so no user is created.

## Gate
- `pnpm typecheck` clean, `pnpm lint` clean. shared 60, db 7, api 405 (389 + 16), web 360 (353 + 7). Worker untouched (not re-run).
- `bash -n infra/smoke.sh` ok. Smoke run against a real API + mtl-jobs on :8799 (e2e DB): closed -> pass; DB row signup on with limits -> pass with warning; user count 3 -> 3 (no user created); row removed -> pass.
- e2e: `signup admin-settings` 7/7 (ran 3x, stable). Full e2e: 52/52 pass (50 + 2 new).

## Deviations (minor, decided)
- `todaySpend` etc. live in `billing/user-quota.ts`, not `lib/system-settings.ts` (avoids lib -> jobs filter import cycle).
- `needsConfirm(new, today)` not implemented in web model: server is the single source of truth (it also knows the affected-job count); UI shows the dialog from the 409 payload. Model has `parseUsd`, `canEnableSignup`, `confirmWarnings`.
- Confirm rule: lowered (new < current effective, or current unlimited) AND (new = 0 OR spent >= new). Re-saving an already exceeded value or raising never asks. `0` always asks (blocks everything).
- GET also returns `env` (defaults) so UI can show placeholders and judge "both limits present" when a field is blank.
- Sign-up toggle is tri-state in the form: untouched keeps stored value (null = follow env); touched stores a boolean.
- Plan "Tests Before" step 3 (temporarily enable rate limit across API suite to prove /sign-in* 3/10s breaks it) NOT run: rationale already confirmed incidentally in e2e (shared-IP bucket returned 429 "Thử lại" on the 4th sign-in within 10s). e2e signup case uses its own `x-real-ip` so it never shares buckets.
- Changed existing tests: `signup.test.ts` `createAuth({ signupEnabled })` -> `isSignupEnabled`/`rateLimitEnabled` (API change required by spec); rate-limit and get-session cases opt in with `rateLimitEnabled: true`.
- Dev DB (`mtl`) on :5442 has not been migrated past 0021 (api there fails on `system_settings`); smoke was run against the e2e DB instead. Run `pnpm db:migrate` before using the dev server.

## Open questions
- DB `null` = env still means admin cannot set "unlimited" over an env threshold (plan open question 3, accepted per plan). `GLOBAL_MONTHLY_USD` still env only (question 4).
- `prod smoke` treats missing `signup` in /healthz as failure; deploy of this release with an older API running would roll back, but new API ships with the new smoke so n/a.

## Review fixes
- M1: `deployment-guide.md` kill-switch/raise-threshold/signup rows now state DB value beats env; emergency = UI or `UPDATE system_settings SET global_daily_usd=0 / signup_enabled=false WHERE id=1`; raising the daily limit on UI auto-resumes (no restart/`--force`); `budget-resume.ts` comment updated. No env override added (DB ?? env kept).
- M2/M3: `limits-section.tsx` - Huỷ calls `save.reset()`; non-`confirm_required` error clears `pending` (error shown); fieldset disabled while the confirm dialog is open.
- L1: smoke description in deployment-guide, `create-user.ts` header, README (lines 3/39/148) mention UI toggle.
- L2: `resolveLimits(stored)` in `system-settings.ts` is the only DB ?? env rule (used by `effectiveLimits`, `isSignupOpen`, PUT limits).
- L3: `signup.test.ts` +fail-closed (reader throws -> 500, no user); admin-email runtime case asserts no user row.
- L4: `effective.signup_open` (same rule as `/healthz.signup`) in GET/PUT; UI shows "Đăng ký công khai hiện: đang mở/đóng" (+ note if enabled but missing a limit) and a Vietnamese error explaining why Save is disabled. "Follow env" reset skipped (not trivial).
- L5: `smoke.sh` header note on 5/h per-IP sign-up rate limit; `|| die` on healthz-signup read and sign-up POST.
- L6: `usdText` uses toFixed + trims zeros (no `1e-7`); web test added.
- L7: `userDailyLimitSql` uses drizzle column refs.
- L8: `lockQueuedOverQuotaLlmJobs` returns `[]` early when effective user limit is null.
- Tests: `admin-limits.test.ts` effective assertion extended with `signup_open`. Gate: typecheck, lint clean; shared 60, db 7, api 415, web 366; e2e `admin-settings signup` 9/9; `bash -n infra/smoke.sh` ok. Nothing staged/committed.
