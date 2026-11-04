# Phase 6 report: users list, cost, disable/enable

Status: DONE (see Concerns)

## Files
- db: `packages/db/src/schema/auth.ts` (+`disabledAt`, 1-line diff from `auth:generate`), `migrations/0024_user_disabled_at.sql` + snapshot/journal, `migrations-down/0024_user_disabled_at.down.sql`.
- api src: `auth.ts` (additionalFields `disabledAt`, `databaseHooks.session.create.before` fail-closed -> 403 `USER_DISABLED`, comment: no `cookieCache`), `middleware/user.ts` (403 `user_disabled`), `billing/user-quota.ts` (`claimableSql` adds `not exists disabled owner`, covers claim + dispatcher), new `routes/admin-users.ts` (GET `/users?q=`, POST `/users/:id/disable|enable`), `routes/admin.ts` (mount).
- api tests: new `admin-users.test.ts` (8), `dispatcher.test.ts` +1 (disabled user doesn't start Modal; enable does).
- web: new `features/admin/users-section.tsx`, `users-model.ts` (+test 2), `admin-sections.ts` (+`users`), `admin-layout.tsx`, `lib/api.ts` (`sessionEffects`, 401 -> refetch session, 403 `user_disabled` -> signOut + `/login?reason=disabled`), `lib/api.test.ts` (+3), `routes/login.tsx` (`USER_DISABLED` copy, `reason` prop), `app/router.tsx` (`validateSearch reason`), `app/layout.tsx` (see deviations).
- e2e: `admin-settings.spec.ts` +2, `env.ts` (`E2E_VICTIM`), `seed.ts` (victim user).
- docs: `docs/deployment-guide.md` (section "Khoá / mở tài khoản" + rollback note), `README.md` (Phase 8 line). Phase file ticked/completed, plan.md phase 6 = Completed.

## Behaviour
- Disable: set flag, THEN `internalAdapter.deleteUserSessions(userId)`. Idempotent. Self / `ADMIN_EMAILS` (trim+case-insens) -> 409 `cannot_disable_admin`; unknown or non-uuid id -> 404. Enable has no admin restriction (a disabled admin row can always be re-enabled).
- List: 1 query, left join of ledger aggregate (30d window, `filter` for today UTC), 500 max, newest first, `ilike` with `\ % _` escaped.
- Hook looks up `user.disabled_at` via API drizzle `db` (not ctx); throws on DB error (sign-in fails closed). Wrong password for a disabled user stays generic 401 (hook runs after password check; no state leak, tested).
- `pnpm create-user` unaffected (no session); tested via `createUser()` + sign-in.
- Claim/dispatcher: disabled owner's jobs not claimed (mac and modal), heartbeat of running jobs unchanged.

## Gate
- `pnpm typecheck` clean, `pnpm lint` clean.
- shared 60, db 7, api 414 (405 + 9), web 365 (360 + 5). Worker not touched/rerun.
- `pnpm auth:generate` -> no diff beyond the staged/unstaged 1 line; `pnpm --filter @mtl/db generate` -> "No schema changes".
- e2e `admin-settings signup routes`: 10/10 (ran twice). Full e2e: 54/54 (52 + 2 new).

## Deviations (minor, decided)
- `routes/admin-users.ts` uses `inJobTx` not `db` (biome rule bans raw `db` in routes).
- `layout.tsx` (AuthGate) not only "refetch on signal": useSession already refetches on `$sessionSignal`, so no change needed for that. But in dev, once the session vanished the dev auto-login would silently log in as the dev owner (would hide the login screen / wrong account). Added: once a session was seen, dev auto-login is skipped. Reason: required for the "falls back to login" behaviour in dev/e2e.
- `api.ts` exposes `sessionEffects` object (refetch/signOut/goto) because the better-auth client is a Proxy and cannot be `spyOn`-ed; tests replace those.
- 403 `user_disabled` redirect uses `window.location.assign` (full navigation; also drops the query cache), 401 uses no reload.
- After re-login the user returns to the page they were on (`next` preserved) - e2e asserts that.
- E2E uses dedicated seed user `victim-e2e` + own `x-real-ip` (sign-in rate limit 3/10s per IP).
- Migration 0024 sequence assumes 0023 (already in repo) - journal checked.

## Open questions
- Plan open question 7 (cancel queued jobs of disabled users instead of leaving them in queue) unchanged: they stay `queued`, documented in deployment guide.
- Disabled-user `queued` job + dev auto-login ordering: none.

## Review fixes

- H1: `notDisabledOwnerSql` exported from `billing/user-quota.ts` (same predicate as `claimableSql`); `lib/health.ts` passes it to `oldestQueuedAgeS`. Test in `dispatcher.test.ts`: disabled owner's old queued job -> `oldest_queued_age_s` null, enabled -> >= age.
- M1: `docs/deployment-guide.md` rollback: revert API/web first; down 0024 only after; notes old API re-claims disabled users' queued jobs (cost) and lets them sign in; cancel their queued jobs first or accept.
- L1: users search debounced 300ms (`users-section.tsx`). L2: list invalidated in `onSettled` (also on error).
- L3: disable uses `coalesce(disabled_at, now())`; test added (second disable keeps first timestamp).
- L4: `dayStart` exported from `user-quota.ts`, reused in `budget.ts` and `admin-users.ts`.
- L5: Modal-token claim assertion added to disabled-owner claim test; meaningless "max 500" assertion dropped (and from test title).
- L6: comment now says d/m/yyyy (vi-VN).
- L7/L8: no change (informational).
- Gate: typecheck, lint, test (web 371, db 7, api 431) pass; e2e admin-settings, routes, signup 10/10 pass.
