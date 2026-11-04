# Code Review: Phase 7 (font hệ thống)

Plan: `plans/261104-1237-admin-settings-ai-providers/` (D7, T16, phase-07-system-fonts.md). I reviewed the staged index (`git show :<path>`) and the phase patch (32 files). I ran no tests, as instructed. The gate numbers below are the implementer's claims and I did not re-verify them.

## Scope
- API: `lib/font-upload.ts` (new), `lib/fonts.ts`, `routes/admin-fonts.ts` (new), `routes/fonts.ts`, `routes/admin.ts`
- DB/shared: `schema/app.ts` (`systemFonts`), `scoped.ts` (`selectShared`), migration 0025 + down, `storage-keys.ts`
- Web: `admin/system-fonts-section.tsx` (new), `admin-sections.ts`, `admin-layout.tsx`, `fonts/api.ts`, `font-settings.tsx`, `series-settings-form.tsx`, `editor/fonts.ts`, `panels/Properties.tsx`
- Tests: api (admin-fonts new, fonts, fonts-upload, claim-fonts, isolate-queue), web (fonts/api.test, fonts-kit.test, admin-sections.test), worker test_job_fonts, e2e fonts.spec
- Docs: job-queue-worker.md, design-guidelines.md, editor.md
- Scout: I checked every reader and writer of `systemFonts`. The only writes are in `routes/admin-fonts.ts`, behind `requireUser` + `requireAdmin` (`admin.ts:13-14`). The callers of `unknownFonts`/`resolveCustomFonts` are `series.ts:206` and `claim-inputs.ts:146`. `claim-inputs.fontInputs` signs `file_key` with no `keyBelongsToUser` check, so `system/` keys get signed correctly. `series-sidebar.tsx:17` and `select-panel.tsx:168` needed no change: `fontLabel` runs over the full list, and the `kit.custom` type widens structurally. Playwright runs serially (`workers: 1`), so the global system-font row can't leak into tests running in parallel. `backup.sh` uses `mc mirror` on the whole bucket, and the lifecycle rule only applies to the export tag. The infra claim holds.

## Overall Assessment
The phase is solid and matches the spec closely. The DRY extraction (`inspectUploadedFont`/`fontView`) keeps the user flow the same: same order (dup → limit → parse) and same error codes. The worker contract (`JobFonts`, `custom-<8hex>`) is unchanged. Tenant isolation holds today. `resolveCustomFonts` returns only own + system fonts, and the test proves another user's font is excluded. The cap check is race-free under the advisory lock, and the sha re-check after the lock handles the concurrent duplicate-commit race. Deleting the DB row before the object is the correct order. I found no Critical or High issues. The main weakness is that the new `Scoped.selectShared` escape hatch is typed much more broadly than its only use. There are also two admin-UX gaps around deletion.

## Critical Issues
None.

## High Priority
None.

## Medium Priority

**M1. `Scoped.selectShared` type admits every table that has no `user_id`, including secrets and auth tables.** `packages/db/src/scoped.ts:34,82`
- `T extends PgTable & { userId?: never }` is satisfied by any table without a `userId` column: `user` (every email), `verification` (auth tokens), `aiProviders` (encrypted API keys), `workerTokens` (token hashes), `systemSettings`, `runtimeFlags`, `dispatches`, `aiModels`. Of all 13 app tables, only those with `userId` are rejected.
- `Scoped` is the project's tenant-isolation boundary ("Truy cập DB giới hạn trong dữ liệu của một người dùng"). This change turns it into a typed raw read for every shared table. A future handler that only has `sdb` could write `sdb.selectShared(user)` and leak all users with no type error and no lint signal. Nothing in the current code exploits this; it is latent.
- Fix: pin the parameter to an explicit allowlist, e.g. `type SharedTable = typeof systemFonts` (a union later) and `selectShared<T extends SharedTable>(table: T, where?)`. Add a `// @ts-expect-error` test for `sdb.selectShared(user)` in the db package tests.

**M2. Deleting a system font is a single click with no confirmation, and its effect is global and irreversible.** `apps/web/src/features/admin/system-fonts-section.tsx:89` (reuses user `FontRow`)
- A deletion is only blocked when some series uses the font as its default. Text boxes in every user's pages that reference the font silently fall back to the default font. The object is deleted right after the row (`admin-fonts.ts:132`), so there is no undo. A misclick changes rendering for all users.
- Same admin area: providers delete has "xác nhận tại chỗ" (design-guidelines.md, Nhà cung cấp). The own-font row has no confirm, but there the blast radius is one user.
- Fix: inline confirm in the system section, reusing the providers' confirm pattern. Keep `FontRow` and pass a confirm flag or wrap `onDelete`.

**M3. The `in_use` 409 tells the admin to do something the admin cannot do.** `system-fonts-section.tsx:15`, `admin-fonts.ts:110-131`
- The copy says "Đổi font mặc định của các series đó trước", but series belong to other users and the admin has no UI to edit them. Any user can block the deletion indefinitely by keeping the font as a series default. In a license takedown ("Bạn chịu trách nhiệm về bản quyền font", line ~51) the only way out is raw SQL. Neither the docs nor a runbook mention this.
- The 409 itself is the spec decision (phase-07 Requirements) and should not be reversed here.
- Fix (within spec): change the copy to something like "…N series của người dùng đang dùng làm mặc định; người dùng cần đổi font trước". Document an operator runbook in `docs/job-queue-worker.md`: SQL to reset `default_fonts` keys pointing to the id, then delete. A force-delete option is a product decision (see Unresolved Questions).

## Low Priority

- **L1. Advisory lock key is a bare magic integer.** `admin-fonts.ts:26` (`7_250_001`). The dispatcher uses `hashtext('mtl_dispatcher')` (`dispatcher.ts:177`) in the same single-bigint key space. A collision is improbable, but mixing schemes is fragile. Use `pg_advisory_xact_lock(hashtext('mtl_system_fonts_cap'))` for consistency.
- **L2. Race between delete and series PATCH.** `admin-fonts.ts:113-120` vs `series.ts:204` `assertKnownFonts`. The two steps don't lock each other: PATCH validates (font exists), then delete counts 0 and commits, then PATCH commits. The series ends up pointing at a deleted font, and later saves that include `default_fonts` return 400 `unknown_font` until the user changes the slot. Own fonts have the same race, so this was not introduced here. Optional fix: `SELECT … FOR UPDATE` on the `system_fonts` row in delete, plus `FOR SHARE` in `unknownFonts`. Otherwise accept and note it in docs.
- **L3. Abandoned admin uploads accumulate.** Uploads under `system/fonts/uploads/<uuid>` that are never committed (or that hit a failed `copyObject`/`allocateCustomFontId`) are never cleaned up. User-font orphans at least go away with account purge. Admin-only, low volume. A MinIO lifecycle rule on prefix `system/fonts/uploads/` (1 day) would close it.
- **L4. Editor eager-loads every system font on every session.** `editor/fonts.ts loadFonts` loads up to 100MB. Presigned URLs change every session, so the HTTP cache never hits. The plan accepted this risk ("tải lười để sau"). Flagged only because the URL signature defeats caching, which makes the cost larger than the risk table implies. Measure before the cap is filled.
- **L5. "Đã thêm font X" also shows when the API returned an existing duplicate (200).** `system-fonts-section.tsx:71`. Cosmetic.
- **L6. `allocateCustomFontId(db as never, …)` in tests.** `apps/api/test/fonts.test.ts:88,91`. `as never` turns off type checking on the argument. Prefer `db as unknown as DbLike`, or use `inJobTx(t => allocateCustomFontId(t, gen))`.
- **L7. Stale comment.** `series.ts:203` says "font gói sẵn hoặc font của người dùng" but should now include system fonts. This file is not in the diff.
- **L8. Process.** The implementer ticked the phase file's Success Criteria and set `status: completed` before review. This should be left to the lead.

## Checklist Results (a–h)
- **(a) Success criteria:** met in code, with tests for each Tests-After item 8–13. Worker rendering is only proven by registration-by-id (the worker is untouched, so that is acceptable).
- **(b) Tenant isolation:** holds today. `resolveCustomFonts` merges own (scoped) + system only. Writes are admin-only, and a test covers 403 on all 4 routes. A user DELETE on a system id returns 404 (tested). Presigned URLs go to `system/fonts/<id>` only, and `fontView` does not expose `createdBy`/`fileKey`. The `selectShared` abuse surface is M1.
- **(c) Upload validation:** matches the user flow exactly (shared `inspectUploadedFont`; `upload-url` bounded by `MAX_FONT_BYTES` via presigned POST range). Key prefix check plus `..` rejection, with a test. Caps are race-free: the advisory lock wraps count+sum+insert, and the sha is re-checked inside the lock. The unique sha constraint is the backstop, and its `.catch` discards `finalKey`.
- **(d) Worker contract:** unchanged. `allocateCustomFontId` checks both tables, all users, with 3 retries, and both insert paths use it. There is no DB-level cross-table constraint, but the residual risk is a concurrent ~2^-32 collision, which is acceptable.
- **(e) Delete semantics:** covers series defaults across all users (jsonb flat map, so `jsonb_each_text` is correct). It does not cover pending jobs or text boxes, which matches the spec and user-font behaviour (the worker falls back). The row is deleted before the object (correct order; a failed object delete only leaves an orphan). Gaps are M2, M3 and L2.
- **(f) Migration 0025 + down:** columns match `user_fonts` minus `user_id`, with unique `font_id` and `sha256`. `created_by` is text with no FK, consistent with existing tables. The down file follows the 0024 pattern. Rollback docs are accurate.
- **(g) Web:** both pickers group fonts as "Font hệ thống" then "Font của bạn" and hide empty groups. `/fonts` and the series-form upload count only own fonts (`ownFonts`), as does the 20-font cap. The sidebar label uses the full list (correct).
- **(h) Docs and copy:** the three docs are updated and accurate. Vietnamese copy is fine apart from M3.

## Deviations (implementer report)
- `Scoped.selectShared`: acceptable in principle, but too broad (M1).
- Cross-user id check through a raw tx: correct and necessary (`font_id` is unique across the whole table; a scoped read would miss other users' rows).
- Advisory lock for the caps: correct (L1 is style only).
- 409 `in_use` with `series_count` and no titles: matches the spec and is tested (`not.toHaveProperty("series")`).
- No infra change: verified (`infra/backup.sh:47` mirrors the whole bucket).

## Recommended Actions
1. M1: restrict `selectShared` to an explicit shared-table allowlist and add a type test.
2. M2: inline confirm for system font delete.
3. M3: fix the 409 copy and add an operator runbook for clearing references.
4. Optional: L1, L3, L6, L7.

## Metrics
- Type coverage: the one notable unsafe cast is test-only `as never` (L6); the `selectShared` impl cast is internal.
- Tests: claimed api 429, web 371, worker 351, e2e 55/55 (not re-run).
- Lint: claimed clean.

## Unresolved Questions
- Should the admin get a "force delete" (reset referencing series defaults to the default dialogue font) for license takedowns? This is a product decision, not reversible by me; the current spec says 409.

**Score: 8.5/10**

Status: DONE
Summary: Phase 7 meets its success criteria. Tenant isolation, upload validation and the cap check are sound, and the worker contract is unchanged. The main issue is that the new `Scoped.selectShared` escape hatch accepts every table without a `userId` (latent cross-tenant read), plus two admin-UX gaps on deletion.
Critical: 0 | High: 0 | Medium: 3 | Low: 8
