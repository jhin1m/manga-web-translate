# Fix report: flaky upload e2e + L1 + L2 + fit-view wheel (B1)

## 1. Flaky `upload-chapter.spec.ts:20` — root cause PROVEN, product bug
- Repro: full `pnpm e2e` with a temp response listener (reverted): `GET /api/recent-chapters` -> 200, 20 chapters, none is "501". Failed again at :73.
- DB check (e2e DB 5442): 36 chapters, 25 with chapter lock still valid (`LOCK_TTL_MS` = 15 min, locks from earlier specs). `/recent-chapters` sorts lock-holders first, then `updated_at`, `limit=20`. Chapter 501 (lock released on leaving) is ranked below 25 locked ones -> dropped.
- Drawer `UploadSection` took the chapter name/link only from that capped list -> fell back to "Chương mới" -> `hasText: "Chương 501"` never matched. Not a timing/load issue; a timeout bump would not help.
- Real-user impact: >20 recently-opened chapters => uploading chapter shows "Chương mới" and no link in Hoạt động.
- Fix (`apps/web/src/features/chapter/activity-drawer.tsx`): per-upload `UploadItem` queries chapter detail (`chapterKeys.detail`, `fetchChapter`, same cache as the chapter screen); name `Chương N · series`, link from `series.id`. Dropped the recent-list dependency.
- Evidence: full e2e green after fix (3 full runs, spec passes in each).
- `--repeat-each=5` on the spec: repeat 0 passes, repeats 1-4 fail (click on "Chương 501" times out) because the spec is not idempotent on a shared DB (chapter 501 already exists; existing behaviour, unrelated to the fix). Not a regression; isolated and full runs are the valid check.

## 2. L1 wheel flip post-cap guard
- `wheel-page-flip.ts`: after lock ends, if `lockDir != 0` and wheel not idle (<300ms gap) -> no swallow, no flip, `acc` reset; `lockDir` cleared on first idle event. Header comment + `docs/editor.md` describe lock, reverse-scroll exception, 1.5s cap, post-cap guard.
- Tests: new "after the cap ... cannot flip until a pause" (red before, verified via stash) + "guard dropped by a pause even if no flip follows".

## 3. L2 batch-edit history query
- `apps/api/src/lib/batch-edit.ts`: `(page_id, version) in ((..::uuid, ..::bigint), ...)` instead of two `inArray` (cross product); comment fixed. Results identical (Map keyed `page:version`).
- API: full suite 32 files / 316 tests pass (includes batch-edit, find-replace, series-ignore-apply).

## 4. B1 fitted page counts as fitting
- Cause: `onWheel` fits used `EDGE`=40, fit view uses `FIT_EDGE`=16; `clampView` left a 48px scroll range, so first notch shifted 24px and flip needed 3 notches.
- Fix: shared `fitsAxis(len, box)` (FIT_EDGE margins, 0.5px tolerance) in `page-layout.ts`; `clampView` centers (pins) content that fits on either axis; `ChapterCanvas.onWheel` uses it. Pinned view = exactly `pageStartView`. `docs/editor.md` updated.
- Tests: unit (fitted page clamps back to fit view for any offset; `fitsAxis` boundary); new e2e "a page fitted with Vừa khung..." (one 100px notch: view unchanged; second flips; up likewise) — fails on old code, passes on new. Existing e2e "scrolling past the page edge..." now clicks "100%" first (a fitted page flips straight away, so it needs a scrollable page).

## Gates
- typecheck, lint (biome 331 files), `pnpm test`: shared 38, web 312, db 5, api 316 all pass.
- Full `pnpm e2e` (46 tests now): 46/46 x3 (one after fix 1, two final), ~3.1-3.2 min.

## Commits (branch feat/editor-user-decisions)
- 87b53e2 fix(web): activity drawer names each uploading chapter from its own detail instead of the capped recent list
- 9709d1d fix(editor): wheel page flip stays disarmed after the lock cap until the wheel pauses
- f30f133 perf(api): batch undo loads exact (page, version) history pairs via row-value IN
- 936b050 fix(editor): a page fitted with Vừa khung counts as fitting for wheel flip and view clamping

## Unresolved
- Worker (python) tests/ruff not rerun (untouched).
- Horizontal axis also pins when width fits with FIT_EDGE (consistency); no dedicated test.
