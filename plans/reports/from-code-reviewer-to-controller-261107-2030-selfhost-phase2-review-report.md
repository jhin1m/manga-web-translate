# Code Review: Self-host phase 2 (local mode runtime)

Branch `feat/selfhost-local-mode`, uncommitted changes. Plan: `plans/261107-1953-selfhost-local-mode/` (Decisions 6-12, 19; phase-02).

## Scope
- API: env.ts, app.ts, index.ts, jobs/runner.ts, jobs/export-cleanup.ts, lib/{health,worker-token,spa-static}.ts, middleware/{user,admin,local-guard}.ts, routes/health.ts, local/* (5 files), tests (local-mode + 5 unit + tenant-isolation edit)
- Web: lib/api.ts, app/{layout,router,app-shell}.tsx, features/admin/{admin-sections,admin-layout}.ts(x), vite.config.ts
- ~870 new LOC + ~300 changed
- Checks run: `pnpm --filter @mtl/api test:unit` 54/54 pass; api + web `tsc` clean; `biome check` clean; `pnpm --filter @mtl/web test` 432/432 pass. Did NOT run `pnpm test` (DB suite, per instruction) — `local-mode.test.ts` and the tenant-isolation change are unverified by me.
- I also ran a scratch probe against `mountSpa` + `localGuard` (results below).

## Overall
Good, tightly scoped work. It matches the phase spec almost line for line. With `MTL_LOCAL_MODE` unset, server behavior is unchanged. The local guard has no bypass I could find with a real browser. I found no critical issues. The real risks are operational: how backups rotate, boot hangs, and a few cache and logging edge cases.

## (b) Behavior when MTL_LOCAL_MODE is unset (VPS): verified
- `env.ts`: `localModeRequested` returns false, so `applyLocalEnvDefaults` never runs. `STORAGE_DRIVER` still defaults to `s3`. `FILES_DIR` defaults to `join("/data","files")` = `/data/files`, same as before. The `GLOBAL_*` production check is unchanged when the flag is off. `forceLocalOff` is not applied. Unit test `env-local.test.ts` "without local mode the old cross-checks still apply" covers this.
- `app.ts`: guard not mounted. `/api/auth/*` and dev-auth are mounted as before (`envDevLogin` only gains `!env.MTL_LOCAL_MODE`). New public routes: `GET /api/config` → `{local_mode:false}` and `GET /readyz`.
- `requireUser` (user.ts:46): ternary falls through to `auth.api.getSession`, same as before.
- `isAdminEmail` (admin.ts:12): `false || <old expr>`. All callers are unchanged: auth.ts:63 sign-up hook, admin-users.ts:36/82, me.ts:19, admin.ts:18. In local mode the sign-up hook blocks every sign-up (fail-closed), which is good.
- `checkHealth`: same semantics. `dbOk`/`storage` now come from `checkReady`.
- `runner.ts`: cleanup only runs when `STORAGE_DRIVER=disk`, so it is off on the S3 VPS.
- Web, one real change on VPS: `AuthGate` now waits for `/api/config` before `useSession` starts. That adds one serial round trip on cold load. If the request fails, the screen stays blank about 1s longer (`retry: 1`, router.tsx:32). `/login` `beforeLoad` makes the same (cached) request. Acceptable; see L1.

## Critical
None.

## High
None.

## Medium

### M1. A boot backup on every restart, keeping only 5, can rotate out the only pre-upgrade backup
`apps/api/src/local/boot-backup.ts:57-69`, `boot.ts:22-27`.
Scenario: upgrade v1→v2 with a migration that succeeds but destroys data (wrong `DROP`/`UPDATE`). Boot #1 dumps the good v1 DB, then migrates. Every later restart dumps the v2 DB again: host reboot, `compose up`, Docker restart policy, a post-boot crash loop such as EADDRINUSE or an env error after boot, or `tsx watch` reloads in dev. After 5 restarts, `pruneBackups` deletes the v1 dump. The user notices the data loss days later and has no backup. A crash loop exhausts the 5 slots within minutes.
This is a trade-off inside Decision 10 ("mỗi lần app khởi động", keep 5). I am not reversing it. Options:
1. Dump only when migrations are pending: compare the entry count in `packages/db/migrations/meta/_journal.json` with `select count(*) from drizzle.__drizzle_migrations`. That is cheap, matches the intent "backup before migrate", and removes the crash-loop churn. Recommended.
2. Keep the current trigger, but never prune the most recent dump taken before a schema change (for example, put the schema version in the name, `mtl-<stamp>-m<N>.dump`, and keep the latest dump for each N).
3. Accept as-is and document "copy a backup elsewhere before upgrading".

### M2. `pg_dump` has no timeout, so boot can hang forever and the container never becomes healthy
`boot-backup.ts:62`. `execFile` gets no `timeout`, and pg_dump gets no `--lock-wait-timeout`. pg_dump waits on any ACCESS EXCLUSIVE lock. An old `jobs` container still running during `compose up -d`, or a stuck session holding a DDL lock, blocks it forever. `/readyz` never opens, `jobs`/`worker` never start, and plain compose has no autoheal, so nothing restarts it. The user sees "starting" forever with no error.
Fix: `exec("pg_dump", [..., "--lock-wait-timeout=30s", ...], { timeout: 10 * 60_000 })`. On timeout, the existing catch removes the tmp file and throws, which is fail-closed with a clear log.

## Low

### L1. Local mode shows a login page that cannot work if `/api/config` fails on first load
`apps/web/src/app/layout.tsx:15-17`. If the config request errors, `SessionGate` renders. In local mode `/api/auth/get-session` returns 404, so the user gets `LoginPage` and a sign-in form that always fails. It recovers only on window focus (the query is refetched because no data is stale) or a reload. The window is small because the same server serves the SPA, but it exists: dev via the Vite proxy, or an API restart just after index.html loads. Fix: on `config.isError`, render a small "Không kết nối được máy chủ — Thử lại" state that calls `config.refetch()`. The VPS web and API ship together, so falling back to SessionGate isn't needed for compatibility.

### L2. A 404 for `/assets/*` is sent with `Cache-Control: public, max-age=31536000, immutable` (verified)
`apps/api/src/lib/spa-static.ts:25`. The header is set before `serveStatic` knows whether the file exists. Probe result: `/assets/missing.js GET 404 public, max-age=31536000, immutable application/json`. Browsers cache a 404 that carries explicit freshness. Impact is small because hashed names don't come back, but the response is wrong and confusing when debugging a bad build. Fix: set the header in `serveStatic({ root, onFound: (_p, c) => c.header("cache-control", ...) })` and drop the pre-set.

### L3. Guard runs before `requestLog`, so blocked requests are invisible in logs, and 403s lack security headers
`apps/api/src/app.ts:43-45`. DNS-rebinding and CSRF attempts are exactly what you want logged. Fix: mount `localGuard` after `requestLog` and `secureHeaders`. The guard is still ahead of every route. Alternatively, `console.warn` inside `forbidden()`, rate-limited.

### L4. `MTL_ALLOWED_HOSTS` entries with a port or bare IPv6 are accepted but never match
`env.ts:41-47`, `local-guard.ts:28`. `nas.local:8080` or `::1` are stored literally, while the guard compares against `URL.hostname` (no port, IPv6 in brackets). The user sets the var and still gets 403 with no hint. Fix: normalize each entry with the same `parseHost` and use `.hostname`, or fail parse with a clear message when an entry contains `:` without brackets or `/`.

### L5. Database password exposed in argv; URL passed positionally
`boot-backup.ts:62`. `DATABASE_URL` (with password) is visible via `ps` and `/proc/*/cmdline` inside the container. `DATABASE_URL` is `z.string().url()` (env.ts:18) and admin-controlled, so this is not an injection risk. Still, prefer `--dbname=<url without password>` and pass the password through `env: { ...process.env, PGPASSWORD }`.

### L6. A disabled local user causes a full-page redirect loop
`local-user.ts:16-25` never clears `disabledAt`, and `user.ts:48` still enforces it. If the row is disabled (DB imported from a VPS, manual SQL), every API call returns 403 `user_disabled`. Web `onSessionLost` (api.ts:57) then calls `signOut` (404) and goes to `/login?reason=disabled`, `beforeLoad` redirects to `/`, and the cycle repeats. The admin UI can't cause this (admin-users.ts:82 refuses to disable self or admin). Fix: in `ensureLocalUser`, `update(user).set({ disabledAt: null })` for the local email, or skip the `disabledAt` check when `MTL_LOCAL_MODE`.

### L7. `app` is always allowlisted, even outside compose
`local-guard.ts:11`. On a host where the single label `app` resolves through a DNS search domain (corporate or ISP), whoever controls that zone could rebind `http://app:8080`. The likelihood is very low. A cleaner option: drop `app` from the hardcoded list and have phase-3 compose set `MTL_ALLOWED_HOSTS=app`. Informational. Decision 19 lists `app` explicitly, so changing it is the controller's call.

### L8. No test for SPA serving
`spa-static.ts` has no unit test (grep confirms). My probe confirmed correct behavior for `/`, client routes, `/assets/a.js`, `/api/nope` → JSON 404, `/healthz`, `HEAD`, and `/..%2fsecret` (traversal rejected by serveStatic 2.1.5, falls back to index). A unit test in `test/unit/` using an mkdtemp dist directory is cheap and would lock in L2's fix.

### L9. Worker behind a non-allowlisted Host loops silently
Not a code defect in this diff. `worker/mtl_worker/main.py:223` treats the guard's 403 as transient, so `claim` retries forever with only a warning. Phase 3 docs or self-host troubleshooting should mention `MTL_ALLOWED_HOSTS` for workers run outside compose (for example `host.docker.internal`).

### L10. `env.ts` import side effect
With `MTL_LOCAL_MODE=1` in the root `.env`, any script importing env (`create-user`, `worker-token`, `auth:generate`) creates `/data/secrets`. On macOS that fails with EACCES. Document "always pair with `MTL_DATA_DIR`" in step 9 / dev docs.

## (c) Security: local-guard detail (verified by probe and reasoning)
| Input | Result |
|---|---|
| `Host: evil.example[:port]`, `localhost.evil.example`, `localhost.` | 403 |
| `Host: localhost:8080@evil.com` (userinfo) | 403 (rejected by the username check) |
| `Host: evil.com#.localhost`, `localhost/x`, `localhost\x` | 403 (hostname is evil / path present) |
| `Host: [::1]:8080`, `LOCALHOST`, `127.0.0.1` | 200 |
| `Host: [::ffff:127.0.0.1]` | 403 (fail-closed, fine) |
| `Host: 0x7f.1` | 200 (normalized to 127.0.0.1; a browser can't produce this for a foreign site) |
| Cross-site form/fetch/beacon POST | Origin is always sent by current Chrome, Firefox 70+ and Safari, so 403. 307 redirect from attacker → `Origin: null` → 403 |
| `/files` POST multipart from the SPA | same-origin, Origin matches, passes. Worker sends no Origin and uses Host `app`, passes |
| Cross-site GET | allowed by design. Every `/api` GET is read-only (checked the full GET route list; `/exports/:id/download` and `/glossary/csv` are downloads). Responses are unreadable: no CORS, and `secureHeaders` sets CORP same-origin and X-Frame-Options |
| Vite dev `/files` proxy | `changeOrigin:false` keeps Host = `localhost:5180` = Origin, passes |

- Secrets: `wx` + mode `0600` (umask can only tighten). Read-retry for 1s covers the window between create and write. An empty file fails loudly with a recovery hint. Env vars take priority over files. OK. A pre-existing `secrets/` directory with wider permissions is not re-tightened, which is harmless because the files are 0600.
- Worker token file: tmp + rename, atomic for a directory bind mount. Token is registered in the DB before the file is written; if the write fails you get an orphan token whose plaintext is lost, which is harmless. No admin HTTP route revokes tokens, so the plan's "revoked on UI" risk can't happen. The worker exits with code 2 on `AuthError` (main.py:220).
- pg_dump: `execFile`, no shell, URL validated as a URL. See L5 and M2.
- SPA: traversal blocked by `@hono/node-server` 2.1.5 serveStatic (rejects `%`, `.`/`..` segments, backslash). Server prefixes excluded by `SERVER_PATH_RE`. Missing index.html → JSON 404 instead of 500.

## (d) React rules of hooks: OK
- `AuthGate` calls `useAppConfig` unconditionally, and the session hooks live in a separate `SessionGate` component. Correct.
- `AdminLayout` calls `useLocalMode()` before the early `return <Navigate>`. Correct.
- `SettingsRoute` calls `useLocalMode()` inline but unconditionally. Correct.
- `AccountMenu` calls it unconditionally. Biome reports nothing.
- When the settings route runs, config is already loaded because AuthGate waits for it, so `parseSection(…, visibleSections(true))` never sees a stale `false`.

## (e) Public contract changes (all additive)
- New env vars: `MTL_LOCAL_MODE` (`1|true|0|false`, invalid → boot error), `MTL_DATA_DIR` (default `/data`), `MTL_SKIP_BOOT_BACKUP`, `MTL_ALLOWED_HOSTS` (csv), `SPA_DIR`. `FILES_DIR` default is now derived from `MTL_DATA_DIR` (same value when unset). In local mode, `API_PORT`, `BETTER_AUTH_URL` and `WEB_ORIGIN` default to 8080. That `API_PORT` default goes beyond the spec, but is consistent with Decision 15. Phase 3 docs must list all of these.
- New public routes on VPS too: `GET /api/config` (one boolean), `GET /readyz` (`{ok,db,storage}`, a subset of `/healthz`). Neither exposes sensitive data.
- Tenant-isolation exemption: an explicit allowlist `PUBLIC_ROUTES = {"GET /api/config"}` plus an assertion that the body equals exactly `{local_mode:false}`. Narrow and correct. Any future public `/api` route still has to be listed explicitly.
- New exports: `registerWorkerToken`, `looksLikeWorkerToken`, `MAX_WORKER_TOKEN_LEN`. `createWorkerToken` signature unchanged. `parseSection`, `validSection` and `groupedSections` take optional params, so existing callers are compatible.

## (a) Acceptance criteria (phase-02)
| Item | Status |
|---|---|
| env flags, defaults, forced-off, warn once | Done + unit tested |
| local-secrets (wx/0600/reread/no overwrite) | Done + unit tested |
| local-user, worker-token-file, registerWorkerToken | Done; DB test written (unverified by me) |
| boot-backup (to_regclass skip, execFile, tmp→rename, prune regex) + boot + `main()` | Done; prune unit tested; dump test `skipIf(!pg_dump)` |
| user/admin middleware | Done |
| app.ts auth conditional, `/api/config` no-store, SPA after routes before notFound | Done (L2) |
| local-guard + spec'd unit cases | Done; all 5 spec cases present, plus extras |
| `/readyz` + `checkReady` | Done |
| export-cleanup + runner hourly when disk | Done + unit tested |
| Web: config hook, AuthGate, hide sign-out, /login redirect, sections filter + test | Done |
| `pnpm --filter @mtl/api test:unit` green | Yes (54/54) |
| `pnpm test` green | Not run by me (instruction) |
| Manual step 9 (no login, /readyz 200, /healthz 503→200, 2nd boot adds a backup) | Not verified; belongs to the phase-4 smoke |

Phase status recommendation: complete pending a green `pnpm test` run. M1/M2 can be fixed in this phase (small) or carried into phase 3 with the docs.

## Recommended actions
1. M2: add `timeout` + `--lock-wait-timeout` to pg_dump (2 lines).
2. M1: controller decides on the backup-trigger option. Option 1 (dump only when migrations are pending) is recommended.
3. L2 + L8: move the cache header to `onFound`, and add a `spa-static` unit test.
4. L3: put the guard after `requestLog`.
5. L4: normalize `MTL_ALLOWED_HOSTS`.
6. L1, L5, L6: small hardening, optional.
7. Phase 3 docs: env var list, `MTL_ALLOWED_HOSTS` for LAN or host workers (L9), dev `MTL_DATA_DIR` note (L10).

## Metrics
- Type check: clean (api, web)
- Lint: 0 issues
- Tests: api unit 54/54; web 432/432; DB suite not run here

## Unresolved questions
- During `compose up -d` with new images, can the old `jobs`/`worker` containers keep running against the DB while the new `app` dumps and migrates? This affects M2 (lock waits) and whether old code runs against a new schema. Phase 3 should consider stopping dependents first (`depends_on` ordering does not stop them).
- Is `app` in the hardcoded allowlist intentional (L7), or should compose supply it through `MTL_ALLOWED_HOSTS`?

Status: DONE_WITH_CONCERNS
Score: 8/10
