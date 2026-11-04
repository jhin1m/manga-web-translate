# Phase 6 review: users list, cost, disable/enable

Reviewed staged diff (`phase6.patch`, 26 files) against plan D7/T3/Q7 + `phase-06-users-list-cost-disable.md`, implementer report. No tests run (per instruction). Unstaged Phase 5 fix-ups ignored; staged blobs read via `git show :<path>`.

## Scope
- API: `auth.ts`, `middleware/user.ts`, `billing/user-quota.ts`, `routes/admin-users.ts` (new), `routes/admin.ts`
- DB: `schema/auth.ts`, `0024_user_disabled_at.sql` + snapshot/journal + down
- Web: `lib/api.ts`, `app/layout.tsx`, `app/router.tsx`, `routes/login.tsx`, `features/admin/users-*`, `admin-sections.ts`, `admin-layout.tsx`
- Tests: `admin-users.test.ts` (8), `dispatcher.test.ts` (+1), `api.test.ts` (+3), `users-model.test.ts` (2), e2e +2
- Docs: `deployment-guide.md`, `README.md`

## Overall
Core security flow is correct and well-ordered. Single auth choke point verified: `requireUser` is the only `getSession` caller (`app.ts:71`, `routes/admin.ts:11`); progress is polling, not SSE, so no long-lived stream survives a disable. Flag-then-delete-sessions ordering is right (flag committed by its own `inJobTx` before `deleteUserSessions`). The sign-in race (hook reads null → admin flags + deletes → session insert lands) is closed by the `requireUser` 403 + web signOut path. Wrong-password stays generic 401 (hook runs after password verification; tested). Admin protection normalizes both sides (`middleware/admin.ts:6-10`) and `create-user.ts:14` lowercases. Admin router guard is swept automatically by `admin-access.test.ts:12`. Claim predicate sits in WHERE before `LIMIT ... FOR UPDATE OF jobs SKIP LOCKED`, so no head-of-line blocking, ordering unchanged, no new locks (subquery on `"user"` is not in `FOR UPDATE OF`). Migration snapshot chain verified (0024.prevId = 0023.id; only `disabled_at` added).

One operational defect the plan missed (health/alert), one docs defect that can cause an outage on rollback.

## Critical
None.

## High

### H1. Disabled user's queued jobs pin `/healthz.oldest_queued_age_s` forever → hourly "high" ntfy alert, masks real stalls
- `apps/api/src/lib/health.ts:42` calls `oldestQueuedAgeS(db)` with no `where`; `oldestQueuedAgeS` (`jobs/dispatcher.ts:68-83`) only filters `status='queued'` + `run_after`. Phase 6 made disabled users' jobs permanently unclaimable (by design, Q7) but did not exclude them here. Dispatcher excludes them (`dispatcher.ts:155` via `claimableSql`), health does not.
- `infra/alert.sh:43-46`: `oldest_queued_age_s > 900` → `notify ... high`, re-alert every `REALERT_S=3600`.
- Failure scenario: admin disables an abusive user who has any queued job (likely — abuse is why you disable). 15 min later the ops channel gets "Hàng đợi cũ ... worker Mac/Modal có chạy không?" at priority high, every hour, until the user is re-enabled or someone deletes jobs by hand. Worse: while it fires, a real worker outage produces the identical alert, so the only stuck-queue signal is now noise. Plan risk table rated "job chờ lâu" as TB × Thấp without considering alert.sh; deployment-guide section doesn't mention it.
- Fix (smallest): export the predicate and apply it in health:
  ```ts
  // user-quota.ts
  export const notDisabledOwnerSql = sql`not exists (...)`;
  // health.ts
  age = await check(() => oldestQueuedAgeS(db, { where: notDisabledOwnerSql }));
  ```
  Add a case next to `dispatcher.test.ts:308` (disabled user's old queued job → `oldest_queued_age_s` null). Alternative is answering Q7 with "cancel queued jobs on disable", which is a product decision; the health filter is needed either way for the race window and is cheap.

## Medium

### M1. Rollback note offers "run down 0024" as an alternative to reverting API — doing that with the new API live takes the app down
- `docs/deployment-guide.md` (new section, staged lines ~312-313): "Rollback migration 0024 (`...down.sql`) **hoặc** quay API về bản trước".
- Failure scenario: operator runs the down file while the Phase 6 API is running. `claimableSql` references `u.disabled_at` → every claim errors (all workers idle); better-auth's drizzle adapter selects schema columns incl. `disabled_at` for `getSession`/sign-in → every authenticated request and sign-in 500s; `session.create.before` select fails → nobody can sign in. Global guide line 84 says rollback app needs no down, but this section contradicts it locally.
- Also incomplete: after API rollback the old claim path picks up disabled users' queued jobs (spends AI/GPU money for a locked account), not just "đăng nhập lại được".
- Fix: "Rollback: quay API/web về bản trước (cột additive, không cần down). Bản cũ không đọc `disabled_at`: người đang bị khoá đăng nhập lại được và job đang chờ của họ được claim lại — huỷ job chờ của họ trước khi lùi nếu cần. Down 0024 chỉ chạy SAU khi API đã lùi."

## Low

- L1 `apps/web/src/features/admin/users-section.tsx:901-905` — query key includes raw input, no debounce: each keystroke runs the full 30-day ledger aggregate (`admin-users.ts:537-566` aggregates all users' ledger rows before the join/limit). Fine at MVP scale with `usage_ledger_created_idx`; add a ~300 ms debounce (or `useDeferredValue`) if ledger grows.
- L2 `users-section.tsx:857-863` — mutation `onError` doesn't invalidate the list. If `deleteUserSessions` throws after the flag commits (`admin-users.ts:578-579`), API returns 500, the row still shows "Hoạt động" though DB says disabled. Use `onSettled: invalidate`. Retry is idempotent, so data is safe.
- L3 `admin-users.ts:578` — repeated disable overwrites `disabled_at` with a new timestamp (loses original lock time). `set({ disabledAt: sql\`coalesce(${user.disabledAt}, now())\` })` if the timestamp is ever shown/audited.
- L4 `admin-users.ts:538` — third copy of the UTC `dayStart` SQL (also `budget.ts:29`, `user-quota.ts:19`). Export one.
- L5 Test gaps: no direct Modal-token claim assertion for a disabled owner (covered only structurally by `and(quota, notDisabled)` and the dispatcher test); `admin-users.test.ts:674` "max 500" asserts `<= 500` on a small table — proves nothing. Acceptable, noted.
- L6 `users-model.ts:818` comment says dd/mm/yyyy; `toLocaleDateString("vi-VN")` yields `4/11/2026` (no zero pad). Fix comment or pass `{ day: "2-digit", month: "2-digit", year: "numeric" }`.
- L7 (informational, pre-existing) App API has no CSRF/Origin check; new state-changing admin POSTs rely on better-auth's `SameSite=Lax` cookie. Acceptable, but if cookie attributes are ever changed (e.g. cross-site embed), `/api/admin/users/:id/disable` becomes CSRF-able with an empty body.
- L8 (informational) A race-surviving session can still hit better-auth's own `/api/auth/*` endpoints (update-user, change-password) since only `requireUser` checks the flag. Window is tiny and web signs out on first 403; not worth more code now.

## Deviations (judged)
- `inJobTx` instead of `db` in route: accepted — same pattern as `admin-providers.ts:13`, `admin-settings.ts:8`; biome bans raw db in routes.
- `layout.tsx` dev auto-login skip after a session was seen: accepted. Production unaffected (`useState(!import.meta.env.DEV)` → `devTried` already true; the new effect only sets true). Dev behaviour change (explicit sign-out no longer auto-relogs as dev owner) is an improvement.
- `sessionEffects` seam: accepted — Proxy client can't be spied; object is internal, not a widening of behaviour.
- `window.location.assign` for 403 path: accepted (also drops query cache).
- `next` preserved after re-login: fine, matches existing AuthGate.
- Dedicated `victim-e2e` + own `x-real-ip`: fine.
- Spec listed `features/admin/api.ts` and `user-quota.test.ts` as modify targets; not touched, coverage moved to `admin-users.test.ts`. Fine.
- Q7 (cancel queued jobs on disable) left open: acceptable as a product question, but see H1 — leaving them queued has an ops cost the plan didn't record.

## Success criteria
- Disable → next action shows login; sign-in 403 `USER_DISABLED`; enable → works: met (API + e2e).
- Disabled owner's jobs not claimed / no Modal; enable resumes: met (Mac claim + dispatcher tested; Modal via shared predicate).
- Cannot disable admin/self (case/space-insensitive): met.
- Cost list matches ledger (UTC today / rolling 30d): met. Note "30 ngày" is rolling `now() - 30 days`, not 30 calendar UTC days — consistent with docs wording, fine.
- `auth:generate`/`db:generate` no diff: snapshot verified consistent; command output not re-run.

## Checklist
- Concurrency: sign-in vs disable race covered by requireUser; admin disable/enable interleavings benign; claim unaffected.
- Error boundaries: hook fail-closed on DB error; deleteUserSessions failure → 500 with flag set (safe, see L2).
- API contracts / backcompat: additive column; old API ignores it (docs M1).
- Input validation: `isUuid` before DB, LIKE escaping correct (Postgres default ESCAPE `\`).
- Auth/authz: admin router = requireUser + requireAdmin, swept by test.
- Query efficiency: claim predicate = PK anti-join; list = one query.
- Data leaks: no account-state leak on wrong password; `disabledAt` returned only to the owner via get-session (harmless).
- Vietnamese copy: consistent "khoá" spelling, messages clear.

## Recommended actions
1. H1: exclude disabled owners in `health.ts` `oldestQueuedAgeS` + test.
2. M1: rewrite rollback paragraph (revert API first; down only after; mention old claim path).
3. Optional: L2 `onSettled` invalidate, L1 debounce.

Score: 8/10

Status: DONE_WITH_CONCERNS
Summary: Disable/enable security flow, hook, requireUser, claim/dispatch filter and migration are correct; health/alert queue-age still counts disabled users' permanently-unclaimable jobs (hourly high alert, masks real stalls) and the rollback docs offer a down-migration path that would break a live API.
Critical: 0 · High: 1
