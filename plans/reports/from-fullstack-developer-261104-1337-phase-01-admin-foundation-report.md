# Phase 1 report: admin foundation, layout, /fonts, system pipeline

Status: DONE_WITH_CONCERNS (see Deviations)

## Files changed
- db: `schema/system-settings.ts` (new, exported), migration `0021_system_settings.sql` (+ meta snapshot/journal, data-copy SQL appended), `migrations-down/0021_system_settings.down.sql`, test `system-settings-migration.test.ts`.
- api: `env.ts` (ADMIN_EMAILS -> normalized string[]), `middleware/admin.ts`, `lib/system-settings.ts`, `routes/admin.ts` + `routes/admin-settings.ts` (GET /settings, PUT /settings/pipeline), `app.ts` (mount before userApi), `auth.ts` (hooks.before blocks admin emails on sign-up), `routes/me.ts` (+is_admin, -settings, PUT removed), `jobs/enqueue.ts` + `jobs/translate-chain.ts` (7 call sites -> `systemPipeline`).
- api tests: new `admin-access.test.ts`; changed `helpers.ts` (seedAdmin), `isolate-queue.ts` (clear system_settings per file, restore ADMIN_EMAILS afterEach), `vitest.config.ts`, `pipeline-settings.test.ts`, `signup.test.ts`, `tenant-isolation.test.ts`, `translate-chain.test.ts`.
- web: `lib/api.ts` (Me), `app/app-shell.tsx|css` (menu), `app/router.tsx` (section search, /fonts), `routes/settings.tsx`, `routes/fonts.tsx`, `features/admin/{admin-sections.ts,.test.ts,admin-layout.tsx,admin.css,api.ts}`, `features/pipeline/pipeline-settings.tsx` (+css comment), `features/chapter/proofread-panel.tsx` (hint text), `features/fonts/font-settings.tsx` (comment).
- e2e: new `admin-settings.spec.ts`; changed `env.ts` (ADMIN_EMAILS, E2E_PLAIN, state type), `seed.ts` (plain user), `fonts.spec.ts`, `routes.spec.ts`, `pipeline-settings.spec.ts`, `signup.spec.ts`.
- docs/config: `.env.example` (ADMIN_EMAILS only), `deployment-guide.md`, `development-setup.md`, `editor.md`, `design-guidelines.md`. Phase file todos/criteria ticked; plan.md phase 1 = Completed.

## Tests added
- db: 2 (copy newest user_settings pipeline; default row + singleton CHECK).
- api: +9 (admin-access 6, signup admin-email 1, pipeline-settings: old route 404 / non-admin 403 / admin setting applies to other user's job = +2; net 322 -> 331).
- web: +3 (admin-sections) -> 336. e2e: +2 (admin-settings).
- "Tests Before" step: existing tests already lock default input_rev, 3 payload snapshots (prepare/reinpaint/ocr_region), shared resolvePipelineSettings and /api/me quota shape, so no new pre-tests were added.

## Gate
- `pnpm typecheck` / `pnpm lint` clean. `pnpm test`: shared 38, db 7, api 331, web 336, all pass. `db generate`: no schema changes.
- e2e: full `pnpm --filter @mtl/web e2e` = 48 pass + 1 fail (signup, fixed, re-run 2/2 pass); targeted admin-settings/pipeline-settings/fonts/routes = 5/5 pass. Had to `playwright install chromium` (browser missing locally).

## Deviations / notes
- `docs/job-queue-worker.md` (plan lists ":254 Cai dat pipeline" + quota line :329) NOT edited per instruction. Still says `PUT /api/settings/pipeline`, per-user settings, "GET /api/me tra settings.pipeline" and quota shown in "Cai dat chung" -> needs a follow-up edit at merge.
- Existing test changed: `e2e/signup.spec.ts` "existing email" case used the owner email, which is now in ADMIN_EMAILS and is always rejected by design; switched to the seeded plain user. Also `tenant-isolation` dropped the removed `PUT /api/settings/pipeline` and excludes `/api/admin/`; `translate-chain`/`pipeline-settings` tests now PUT via admin route.
- Plan said `pipelineSettingsOf(tx, userId)` removed; `userId` params of some enqueue helpers are still used elsewhere so kept.
- Proofread panel hint no longer points normal users to a settings page they cannot open: "Model do quan tri vien chon." (minor UX decision).
- Local dev: `.env` has no `ADMIN_EMAILS`, so the dev user will not see Settings until `ADMIN_EMAILS=<email>` is added to the local `.env` (not edited; gitignored).
- `apps/api/src/billing/prices.ts` shows as modified in git: that is the concurrent worker-phase agent, not this phase.

## Unresolved questions
- None blocking. `user_settings` still exists (stops being read/written), drop is out of plan scope.
