# Code review: last fixes (87b53e2, 9709d1d, f30f133, 936b050)

## Scope
- Commits: `87b53e2` (activity drawer), `9709d1d` (wheel flip post-cap guard), `f30f133` (batch undo row-value IN), `936b050` (`fitsAxis`, fitted page pinned).
- Checks run: `tsc --noEmit` (web) clean; web vitest `src/features/editor` + `src/features/chapter` 31 files / 271 tests pass; API `test/find-replace.test.ts` + `test/page-state.test.ts` 35 pass; EXPLAIN on the API test DB; a pure simulation of `stepFlip` on the old and new code. No Playwright run.

## Findings

### M1. Medium: continuous wheel scrolling through a tall page no longer turns the next page (9709d1d)
- `apps/web/src/features/editor/wheel-page-flip.ts:87`: `if (s.lockDir !== 0 && !idle) return ...`.
- The guard only clears `lockDir` after a gap of 300ms or more. It runs whether or not the view is still at the edge.
- Scenario: page taller than the frame (100% or zoomed), mouse wheel at one notch every 100ms with no gap over 300ms. Page 1 bottom flips to page 2. The wheel scrolls through page 2 and reaches its bottom. Page 3 never opens until the user pauses.
- Simulation, 900px frame, 2000px page, 100px every 100ms:
  - Old code: flips at t=1100, 3900, 6700.
  - New code: flips once at t=1100, then reaches the bottom of page 2 at t=3700 and never flips again.
- The previous review (L1) asked for this guard to stop a momentum tail on a page that fits the frame. Its open question ("confirm this is wanted") was never answered. Long pages lost continuous reading as a side effect.
- Fix: arm the guard only while the view is at the target edge. Clear it once the wheel has scrolled away from that edge:
  ```ts
  const edge = dir > 0 ? i.atBottom : i.atTop;
  if (s.lockDir !== 0 && !idle && edge) return { state: { ...s, acc: 0, last: i.t }, flip: 0, locked: false };
  const lockDir = 0;
  ```
  - A fitted page is always at both edges, so a fling there still cannot flip a second page. The simulation gives 1 flip.
  - A tall page flips again after it is scrolled through: 3 flips, the same as the old code.
  - The existing 17 `wheel-page-flip` tests pass with this change (run against a copy).
  - Trade-off: on a page only slightly taller than the frame, a long trackpad tail could still scroll to the bottom and flip. That is product intent, so the user should decide. Add a unit case for "continuous wheel through a tall page flips at its end".

### No findings
- **87b53e2 (drawer):**
  - `UploadItem` mounts only while the drawer is open (`ShellActivity` `open &&`). It makes one GET `/api/chapters/:id` per chapter uploading in this tab, with the default `staleTime` of 5s and `retry` 1.
  - It adds no polling. `upload-manager.ts` never invalidates `chapterKeys.detail`.
  - The key and `queryFn` match `use-chapter-data.ts:49`, so the cache is shared with the chapter screen and the data has the same shape. `series.{id,title}` exists on `ChapterDetail`.
  - Requests are tenant-scoped on the server.
  - A deleted chapter (404) falls back to the label "Chương mới" with no link. That is acceptable.
- **f30f133 (undo):**
  - The `sql` fragment goes into `scoped.select`, so `user_id = $1 AND (...)` is kept.
  - The empty list case is guarded by `moved.length ? ... : []`.
  - Casts are `uuid` and `bigint`, matching the `bigint` `version` column.
  - EXPLAIN shows a BitmapOr of Index Scans on `page_state_history_page_idx` with an exact `(page_id, version)` condition.
  - There are 2 bind parameters per moved page, far under the 65535 limit.
  - The `moved` and `wrote` branch is exercised by the find-replace skip-mode test (two batches undone in reverse order).
- **936b050 (fitsAxis):**
  - `clampAxis` is continuous at both thresholds. The centred value `(box-len)/2` lies inside `[box-len-EDGE, EDGE]` whenever `len >= box-80`, so Ctrl+wheel zoom across the fit boundary does not jump.
  - The horizontal and split-mode pinning applies only when the content fits with `FIT_EDGE`, which is what "Vừa khung" produces anyway.
  - Space-pan, `revealRect`, resize/split re-fit and `flipTo` (y = -inf) all go through the same `clampView` and give the centred view.
  - No e2e asserts exact view x/y.
  - The existing e2e switching to "100%" is not hiding a regression. The old premise ("at fit the page scrolls a few tens of px") was the bug itself, and the new e2e covers the fitted case.

## Unresolved questions
- M1: while the wheel keeps going with no pause, should a page taller than the frame be allowed to flip at its end (edge-gated guard), or should every flip need a 300ms pause (current code)?

Status: DONE_WITH_CONCERNS
