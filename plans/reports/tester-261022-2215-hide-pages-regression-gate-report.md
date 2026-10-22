# Regression gate: hide pages (branch feat/skip-p3-hide-pages, uncommitted)

Date: 2026-10-22. Source and test files not modified.

## Results

| # | Step | Result | Counts |
|---|------|--------|--------|
| 1 | `pnpm typecheck` | FAIL (apps/api) | shared, db, web pass; api 1 error |
| 2 | `pnpm lint` (biome) | FAIL | 255 files checked, 1 formatter error |
| 3 | `pnpm test` (vitest) | PASS | shared 8/8, db 3/3, web 157/157 (28 files), api 166/166 (20 files) = 334 pass, 0 fail |
| 4a | `uv run pytest` (worker) | PASS | 160/160 |
| 4b | `uv run ruff check .` | PASS | clean |
| 5 | `pnpm --filter @mtl/web e2e` | PASS | 25/25, 1.4 min, 1 worker |

Note: test total is 334 (JS) + 160 (Python) = 494 tests. Step 3 excludes the worker suite.

## Failures

### 1. Typecheck: apps/api/test/chapters.test.ts:408

Reproduced on re-run of `apps/api` typecheck alone (deterministic).

```
test/chapters.test.ts(408,41): error TS2339: Property 'skipped' does not exist on type '{ id: string; ord: number; status: string; }'.
```

Cause: the local `progress()` helper return type (no `skipped` field) is used by line 408:
`afterHide.pages.map((p) => p.skipped)`. `afterHide` is typed as `Progress & { pages: { id; skipped }[] }`, but the expression `(await progress(ch)).pages` at line 396 is typed without `skipped`. Likely fix in the test (type the helper or cast), not the route.

Runtime impact: none seen. Vitest does not typecheck, and the test passed at runtime (166/166), so the API does return `skipped` in progress. This is a type-only break, but `pnpm typecheck` (and CI if it gates on it) fails.

### 2. Lint: apps/web/e2e/chapter-tools.spec.ts:274

Biome formatter wants a multi-line chain:

```
272 │     await expect(rail.getByRole("button", { name: /^Trang \d/ })).toHaveText([/^Trang 1/, /^Trang 3/]);
274 │ - ··await·page.getByRole("status").filter({·hasText:·"Đã·xoá·trang·2"·}).getByRole("button",·{·name:·"Hoàn·tác"·}).click();
```

Cause: unformatted line in the e2e spec this feature touched (file is in `git status` as modified). Fix: `biome format --write` on that file. This is formatting only. The e2e test on the same spec (test 4, "delete a page from the rail") passes.

## Passing detail

- Step 5 hide-pages coverage: `chapter-tools.spec.ts:263` "delete a page from the rail (undo, then restore from the Đã xoá filter)" passed (2.2s).
- Worker: `test_export_slices.py` 17/17 passed (hidden-page slice drop and renumbering path).
- No flaky tests observed. Failing steps were not re-run as flakiness checks beyond the api typecheck re-run, which reproduced; the lint error is deterministic formatter output.

## Gaps (not failures)

- Hidden-page logic in translate/retry/retranslate/progress/export/find-replace/glossary-apply has no e2e check beyond the rail delete/restore flow. Unit coverage in api tests appears to cover progress/translate-prepared (`chapters.test.ts` ~L396-415).
- Worker export for hidden pages: covered by the unit test only; no end-to-end export run with a hidden page in this gate.

## Unresolved questions

1. Is the `pnpm typecheck` failure acceptable to merge, or should `chapters.test.ts` be typed before commit? (Not fixed here, per instructions.)
2. Is `biome` lint part of the pre-commit / CI gate? If not, the formatter error is non-blocking.
3. Are the untracked `TODO.md` and `plans/` artifacts meant to be committed? Not in scope for this gate.

Status: DONE_WITH_CONCERNS
Summary: Tests pass everywhere (JS 334/334, worker 160/160, e2e 25/25, ruff clean). Gate not green: `pnpm typecheck` fails on a test-file type error (apps/api/test/chapters.test.ts:408) and `pnpm lint` fails on one formatter diff (apps/web/e2e/chapter-tools.spec.ts:274). Neither is a runtime failure.
Concerns/Blockers: Typecheck and lint must be fixed in the test/format files before the gate passes. I did not change them, per instructions.
