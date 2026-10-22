# Code Review: glossary scoped by language pair

## Scope
- Files: 18 modified + 6 new (api glossary/enqueue/find-replace/validate/glossary-scope, db schema + 0006 up/down/snapshot, web glossary api/editor/ApplyGlossary, series page/sidebar/settings-form/lang-labels, router, tests, e2e spec)
- LOC: ~+475 / -127 (tracked) + new files
- Focus: uncommitted diff vs plan 261022-1026 (phases 1-3; phase 4 docs excluded)
- Verification done beyond reading: migration 0006 applied on a throwaway DB (`mtl_review_0006`, migrated 0000-0005 via drizzle migrator, seeded, then 0006 up -> down -> up again; DB dropped afterwards). No repo files changed.

## Overall Assessment
Clean, scoped change. No Critical/High defects. Every consumer of `glossary_entries` in `apps/` (`enqueue.ts`, `find-replace.ts`, `routes/glossary.ts`) is converted; no stray `isNull(glossaryEntries.seriesId)` without pair outside `scopeWhere`. Tenant filter is inside `seriesGlossaryWhere`, so raw `DbLike` read in `translateSettings` is safe. Public contract changes are limited to the intended ones.

## Critical Issues
None.

## High Priority
None.

## Medium Priority

### M1. App rollback (without DB down) can wipe glossary entries of every pair through old CSV `replace`
- Where: behavior of the pre-change `importCsv` (`git show HEAD:apps/api/src/routes/glossary.ts`, `scopeWhere(null)` = `series_id IS NULL`), interacting with new data model from `packages/db/migrations/0006_glossary_lang_pair.sql`.
- Scenario: deploy 0006 + new API, users create ko→en / ja→en workspace entries, app is rolled back (deployment guide assumes additive migration => app rollback without DB down). A user imports workspace CSV with mode `replace` -> old code deletes **all** workspace entries of all pairs, then inserts with NULL pair (invisible to the new code after re-deploy). Old export also mixes pairs into one CSV, and old GET shows duplicate terms across pairs.
- Plan risk text (phase-01 "Rollback app") only says the old code "gộp mọi entry chung như trước, không lỗi" — it misses the destructive `replace` path.
- Fix: add one line to the rollback note in `docs/deployment-guide.md` (docs owner, parallel edit): "During an app rollback over 0006, do not use workspace CSV import mode replace; it deletes workspace entries of all language pairs." No code change needed.

## Low Priority

### L1. Down + re-up relabels a non-ko→vi survivor as ko→vi (verified)
- Where: `packages/db/migrations-down/0006_glossary_lang_pair.down.sql:6-11` + backfill at `0006_glossary_lang_pair.sql:4`.
- Verified: workspace A has `회장` ko→vi ("chủ tịch") and ko→en ("chairman", newer). Down keeps only the newest (`chairman`); re-up backfills it as ko→vi -> ko→vi series now get the English term forced by prompt (the exact M3 symptom).
- Fix (cheap): tie-break prefers the ko→vi row before `updated_at`, e.g. compare
  `((g.source_lang, g.target_lang) IS NOT DISTINCT FROM ('ko','vi'), g.updated_at, g.id) < ((newer.source_lang, newer.target_lang) IS NOT DISTINCT FROM ('ko','vi'), newer.updated_at, newer.id)`
  (false < true, so the ko→vi row wins). Or keep as is and extend the header comment: "after down+up, surviving entries are relabelled ko→vi".

### L2. `PairScope` widens langs to `string | null` and casts with `as string`
- Where: `apps/api/src/routes/glossary.ts:40-41,57-62,69-70`.
- Effect: for a legacy NULL-pair workspace entry (rollback-window write), PATCH builds `eq(source_lang, NULL)` -> `= NULL` -> `assertUniqueTerm` never finds a duplicate; the DB unique (NULLS NOT DISTINCT) still raises 23505 -> `writeOrConflict` -> 409. So behavior is correct, only the pre-check is silently skipped and the casts hide it.
- Fix (optional): type route scopes as `SourceLang/TargetLang` and give `scopeOfEntry` an explicit `isNull` branch, or leave it with a comment that the DB constraint is the backstop. Not blocking.

### L3. Duplicate query-validation pattern
- `apps/api/src/routes/chapters.ts:112-116` hand-rolls the same `invalid_query` response that the new `parseQuery` (`apps/api/src/lib/validate.ts:17-26`) provides. Out of scope; follow-up only.

## Edge Cases Checked (scout)
- Migration ordering (verified on throwaway DB): ADD COLUMN x2 -> backfill -> DROP old unique -> ADD new unique NULLS NOT DISTINCT (5 cols, same name, so `isTermConflict` keeps matching) -> rev bump. Result: workspace entries `ko/vi`, series entries NULL/NULL.
- Rev bump predicate (verified): ko→en series in a workspace with workspace entries +1; ko→vi series 0; ja→en series in a workspace with no workspace entries 0; ja→en series with only series-own entries 0. `series.source_lang/target_lang` are NOT NULL, so `IS DISTINCT FROM` row compare is exact.
- Down (verified): runs in BEGIN/COMMIT, drops new unique before dedupe, recreates old unique, drops cols, removes last `__drizzle_migrations` row; re-up afterwards succeeds.
- Snapshot `0006_snapshot.json` unique matches schema (5 cols, nullsNotDistinct).
- Tenant isolation: `seriesGlossaryWhere` includes `eq(workspaceId, s.workspaceId)`; covered by the cross-workspace ko→en test in `apps/api/test/glossary.test.ts`. `bumpGlossaryRev` uses `Scoped.update` (workspace-scoped).
- 403 before 400: `parseQuery` runs in handler after `requireWorkspace`; tested.
- PATCH/DELETE: scope from entry, pair immutable (EntryPatch has no lang fields); rev bump unchanged.
- CSV: replace/merge only touch the selected pair; export filename built from enum-validated values (no header injection).
- Web: `glossaryKey` keeps `["glossary", ws]` prefix, so `done()` in the editor and the settings-form invalidation refresh series + every cached pair. Editor remounts per pair (`key`), so drafts/pending replace do not leak across pairs. Nav link `/w/$ws/glossary` without search falls back to ko→vi. E2E DB is reset per run (global-setup), so fixed term names are safe.
- Settings warning: same query key as `SeriesTabs` (deduped), compares saved vs form pair; non-blocking; invalidation only when the saved pair actually changed.
- No hard-coded KO/VI left in web glossary UI (grep).

## Acceptance Criteria (plan.md / phases)
| Criterion | Status |
|---|---|
| ko→en series excluded from ko→vi entries in translate payload and glossary-apply (400 unknown_terms) | Met (tests) |
| Same term in two pairs; duplicate in one pair -> 409 | Met (test incl. PATCH) |
| Workspace entry change bumps every series; migration bumps non-ko→vi series | Met (test + empirical migration run) |
| Migration additive, no CHECK | Met |
| Workspace routes 400 on missing/invalid pair; CSV replace pair-only | Met |
| ko→vi series payload unchanged | Met (test on seeded ko→vi series) |
| Glossary page pair in URL; settings warning | Met (e2e) |
| Test/typecheck/lint green | Reported green by lead (not re-run) |
| Phase 1 step 5 down+up on dev | Done here on a throwaway DB |
| Docs updated, M3 marked handled in previous plan | Not in scope of this review (parallel docs work) |
| Plan/phase status fields | Still `pending`/`todo` — lead to update |

## Recommended Actions
1. (M1) Add the rollback warning about workspace CSV `replace` to the deployment-guide rollback note.
2. (L1) Prefer ko→vi in the down dedupe tie-break, or document relabelling.
3. (L2, L3) Optional cleanups; not blocking.

## Metrics
- Type coverage: no new `any`; three `as string` / `as SQL` casts (existing pattern for `and()`).
- Tests: new API tests cover all phase-2 step-4 items; web unit (scopePath/glossaryKey, langChangeWarning) + 2 e2e.
- Lint issues: 0 (reported).

## Unresolved Questions
- None blocking. M1 depends on whether app rollback over 0006 is a realistic operation for this MVP.
