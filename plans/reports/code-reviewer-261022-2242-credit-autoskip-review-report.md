# Code Review: Phase 4, auto-skip credit images (uncommitted, `feat/skip-p4-credit-autoskip`)

## Scope
- 21 modified + 10 new files, about 370 LOC of code changes (plus tests and the e2e helper)
- Re-ran: `vitest test/series-skip-images.test.ts test/tenant-isolation.test.ts` (17/17), shared `vitest` (12/12), `drizzle-kit check` (OK)
- Did not run Playwright (as instructed)

## Overall
The feature is solid and matches the plan closely. It respects tenant scoping, and every contract change is additive. The tests are real integration tests against Postgres and MinIO, not phantom tests. No blockers. The main risks are a learn race, a dead-end after a `not_uploaded` 409, and false matches on low-detail images.

## Critical
None.

## High
None.

## Medium
1. **The learn endpoint is not serialized, so concurrent learns duplicate.** `apps/api/src/routes/series-skip-images.ts:99-125`
   - Read-known, dedupe, cap check, copy and insert all run with no transaction or lock.
   - A double-click on the toast button sends 2 POSTs. `chapter-workspace.tsx:432-451` never disables the button while `learnSkip.isPending`, and the toast stays up until the request finishes.
   - Each POST can then insert a row and copy an object. Two tabs can also push past `MAX_SKIP_IMAGES`.
   - Impact: duplicate thumbnails in settings. Matching itself is still correct.
   - Fix: wrap the route in `sdb.transaction` and take `SELECT … FOR UPDATE` on the series row (or `pg_advisory_xact_lock(hashtext(series_id))`) before reading `known`. Also disable or remove the action once clicked.
2. **The `not_uploaded` 409 is a dead end in the most likely scenario.** `series-skip-images.ts:108`, `chapter-workspace.tsx:443`
   - The credit image is usually the last file, so it uploads last. Users delete it from the rail (local URL) while upload is still running.
   - The 409 notice then replaces the toast that held the action. The only way to retry is to restore the image, delete it again and click again.
   - Fix (client, pick one): wait for that item's upload before POSTing (the upload manager already tracks status), or put a "Thử lại" action on the error notice.
3. **Low-detail images risk false matches.** `packages/shared/src/dhash.ts:52-56`
   - The comparison is strict `>`. Near-uniform images (credit pages are often white background with little text, and so are white-gutter webtoon slices) hash to almost all 0s.
   - In a series with fixed slice sizes (same aspect ratio), a learned white credit can silently skip story slices before Step 1. That page then disappears from translation and export, and the only signal is "đã bỏ 1".
   - The measured "0 false matches" covers a single chapter, not this case.
   - Fix: reject learning with 409 `low_detail` when `popcount(dhash) ≤ 8 || ≥ 56`, or give low-detail hashes a stricter threshold (≤ 2 bits). Test with a mostly-white PNG.
4. **Acceptance criterion not met (docs).**
   - The phase file still says `status: pending`. The final threshold and the timing measurement (96 images about 0.1s, 0 false matches) are not recorded in the phase file, although the Success Criteria require it.
   - `plan.md:34` still says Pending.
   - The lead or planner should update these. Do not encode them in code.

## Low
5. `apps/api/src/storage.ts:122`: `CopySource` is not URL-encoded. It is safe today because keys only contain `[a-z0-9-/.]`, but it breaks if the key scheme ever adds special characters. Use `` `${Bucket}/${from.split("/").map(encodeURIComponent).join("/")}` ``.
6. `series-skip-images.ts:98`: learning from a page that has no whole image (common when a webtoon page is stitched across slices) returns `no_hash` with the message "Ảnh này không có dấu nhận dạng". That message is wrong for this case. Use a separate code, e.g. `no_whole_image` with "Trang không chứa trọn ảnh gốc nào".
7. `apps/web/src/features/chapter/source-rail-model.ts:305-313`: with an even count, the median is the mean of the two middle values, so small chapters flag the story images too. The test even asserts `[800, 1000]`, so both get flagged. It is only a hint, but the lower median (`known[mid-1]`) or a mode would be less noisy.
8. `series-skip-images.ts:44-46`: `sameImage` throws `RangeError` on a malformed `dhash` row, which turns every chapter create in that series into a 500. Today the data only enters through the zod regex. Consider a DB `CHECK (dhash ~ '^[0-9a-f]{16}$')` or skipping bad rows in the matcher.
9. `apps/api/src/routes/series.ts:323`: the series prefix is assembled by hand while the key lives in `storageKeys.seriesSkip`. Add a `storageKeys.seriesPrefix(ws, id)` so the key layout is defined in one place.
10. `apps/web/src/features/upload/image-fingerprint.ts:24`: it decodes full-resolution bitmaps 4 at a time. A tall webtoon image (800×20000) is about 64MB RGBA, so peak memory is about 250MB. That is acceptable for now; note it if users report crashes on mobile Safari.
11. The "Luôn bỏ" action is shown even when the image has no hash (fingerprinting failed), which leads to a 409. This is minor: the rail does not have `dhash`, so hiding the action would need an extra response field. YAGNI.

## Verified OK (regression touchpoints)
- **Chapter create:** `creditMatcher(tx, …)` reads inside the create transaction. With no new fields the behavior is unchanged (`skip: null`). An invalid hash returns 400 (tested).
- **Commit/skip:** credit-skipped files go through the same `skip IS NULL` filter. Restoring via PATCH works, and commit counts are correct (tested). If every file is skipped, commit returns the existing 400 `no_valid_files`.
- **Resume:** `resumeChapter` matches on bytes over all `source_files` rows. Skipped files are still uploaded, so restore keeps working.
- **Page hide toast:** `actions[]` keeps "Hoàn tác" first, and keys are unique by label.
- **Series delete:** FK cascade on `(workspace_id, series_id)`. The prefix is cleaned after the DB delete (better than the plan's "inside the callback": objects are removed only after the rows are committed). Tested.
- **Tenant isolation:** every route goes through `scoped()`. A series, chapter or page from another series or workspace returns 404, and the wrong workspace in the URL returns 403. New routes were added to `RESOURCE_CASES`.
- **Contracts are additive:** optional fields on the `createChapter` body, `width` on source-files, 3 new routes. `seriesKeys.skipImages` nests under the series key.
- **Patterns:** local `conflict()` returns a 409 body `{error, message}` like the other routes, comments are in Vietnamese, and the down migration matches the 0008 format and notes that orphaned objects are left behind.
- **Object leaks:** copy-then-insert and delete-row-then-object both leave orphans only under the series prefix, which series delete cleans up.
- **Trust model:** the route header documents that client-sent hashes are trusted within the workspace, consistent with the plan.

## Plan task status
Steps 1-7 are implemented, and the tests listed in step 6 exist: API matching at 3 bits / 10 bits / 20% aspect, page learn with 2 slices, cross-workspace 404, web model, upload-manager, e2e. `storage-presign.test.ts` and `series.test.ts` were not extended, but `series-skip-images.test.ts` covers copy and delete-prefix. Measurements are not yet written to the phase file (#4).

## Score: 8/10

## Unresolved questions
1. Is a learned white or blank image (spacer, blank page) auto-skipping same-size story slices acceptable, or should learning refuse low-detail hashes (#3)? This is a product decision.
2. Should "Luôn bỏ" wait for the upload to finish, or should the error offer a retry (#2)?
