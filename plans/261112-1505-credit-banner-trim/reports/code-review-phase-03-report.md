# Code review: phase 3 (learn series banner): `c9756f3` + `d45ef43`

Score: **7.5/10**. Critical 0 · High 0 · Medium 3 · Low 6.

Gates were run on commit `d45ef43` in a separate detached worktree (the main working tree has another agent's edits):
- `pnpm typecheck` passes.
- biome passes on the 27 touched files.
- `apps/api` `test/series-skip-images.test.ts` passes 13/13.
- web vitest passes 498/498.

e2e was not re-run. Old whole-image tests are unchanged: the only `-` lines in the test diff widen the `SkipImage` type and the `learn` helper's body type.

## Verified OK
- **(a) Migration 0028 and the down file:** the new column is nullable and the check allows only null, `top` or `bottom`. The down file follows the same pattern as 0027.
- **(a) Whole-image credit is unchanged:** `creditMatcher` reads only `edge IS NULL` rows. The whole-image dedup ignores band rows (`k.edge === null`). The shared 100 limit counts all rows. The matcher test covers both directions.
- **(b) Ownership:** `sdb.byId(sourceFiles)` is scoped to the user, and `chapterInSeries` returns 404 for another series.
- **(b) Band size and checks:** band height comes from the server's `trim[edge]`, not the client. Width comes from `source_files.width`. `DHASH_RE` rejects a bad hash with 400. The strict union rejects mixed bodies.
- **(b) Duplicates:** dedup compares only same-edge rows with `sameImage`.
- **(b) Limit concurrency:** the band path uses the same `FOR UPDATE` lock on the series row as the whole-image path. Under READ COMMITTED, a second request reads the rows the first one committed, so the limit and dedup hold under concurrency.
- **(b) GET and DELETE:** GET returns `edge`. DELETE did not change and works for band rows.
- **(c) EXIF orientation is consistent everywhere:**
  - the worker uses `ImageOps.exif_transpose` (`worker/mtl_pipeline/images.py:52`);
  - `createImageBitmap` uses `from-image` by default;
  - the trim UI measures `<img>.naturalHeight`, which is also orientation-applied.
- **(c) Hash path matches the whole-image one:** `fingerprint` and `bandFingerprint` share `dhashOfRegion`, so band hashes are comparable. The `bottom` window is `H - band`, as the unit test checks.
- **(c) Image URL:** `it.url` is the original file (local blob or signed `storageKey` URL from `pages.ts:77`), not a thumbnail, so the pixel coordinates are right.
- **(c) Memory:** decoding the full image (720×15000 ≈ 43 MB RGBA) costs the same as the existing upload `fingerprint`, so this is not a regression.
- **Phase 4 can use the stored data:** `width` is the full image width in the same oriented pixel space as `height` (band px). `bandWindow` scales by `imgW / band.width`, which matches.
- **(d) No duplicate requests from a double click:** the action calls `notify("Đang lưu…")` synchronously, which replaces the toast and removes the button. Two tabs at once are serialized by the series lock.
- **(e) Thumbnail CSS math:**
  - frame height = frameW·h/w; image height = frameW·H/W, anchored at the top or bottom;
  - so the visible part is exactly the band;
  - the selector `.skip-band img` (0,2,1) overrides `.skip-images-grid img`'s `aspect-ratio: 3/4`.
- **CORS (dev):** MinIO dev sends `Vary: Origin` (probed), so an `<img>` cache entry does not poison the CORS `fetch`.

## Medium

**M1. A terminal 409 on one edge aborts the other edge, and "Thử lại" can never succeed**
- Where: `apps/web/src/features/chapter/chapter-workspace.tsx:832-845`
- The loop runs top first. A throw from `learnSkipImage` (for example `plain_image`) jumps to the outer catch, so the bottom edge is never sent.
- Scenario: the user trims a plain white margin at the top and the credit banner at the bottom, then clicks "Luôn cắt". The top band gets `plain_image`. The toast shows "Dải gần như trơn…" with "Thử lại". Every retry fails the same way, and the banner is never learned. The only workaround (trim only the bottom, learn, then re-trim) is not discoverable.
- The same happens with `skip_images_full` and `no_trim`: they are terminal, but the toast still offers a retry.
- Fix:
  - wrap each edge in its own try/catch and collect per-edge results;
  - report a mixed result, e.g. "Đã học dải cuối; dải đầu gần trơn nên bỏ qua";
  - offer "Thử lại" only for network, decode or 5xx errors, not for terminal 409s (`plain_image`, `no_trim`, `skip_images_full`, `no_hash`).

**M2. The client hashes one band height while the server stores another**
- Where: `apps/web/src/features/chapter/chapter-workspace.tsx:833-841` and `apps/api/src/routes/series-skip-images.ts:205`
- The client hashes `trim[edge]` from the toast closure. The server stores `height = f.trim[edge]` as read at request time, without a lock on the chapter.
- Scenario: the user changes an existing trim from 100 to 150 px, so the toast offers "Hoàn tác" back to 100. The user clicks "Hoàn tác" and then "Luôn cắt" while the undo PATCH is in flight. The client hashes the 150 px band, but the server reads trim 100 and stores `{dhash(150px), height: 100}`. Dragging the trim during a slow signed-URL fetch hits the same window.
- Impact: phase 4 uses `height` to size the window it hashes, so this row never matches, or matches the wrong region. It also uses one of the 100 slots. The implementer report notes this only for the retry path; the undo path is the more reachable one.
- Fix: send `band_px` in `BandBody`. The server returns 409 `trim_changed` when it differs from `trim[edge]`. The server stays authoritative and the race fails closed.

**M3. Thin bands are accepted, but phase 4 can never match them**
- Where: `apps/api/src/routes/series-skip-images.ts:205-207`
- Any `bandHeight > 0` is accepted. Phase 4's `bandWindow` returns null when `sh < 8`, so a band of 1–7 px (after scaling by width) is stored, counts toward the limit, and the toast says "Đã học 1 dải", but it never applies.
- A 9×8 hash taken from a band only a few px tall is also mostly upsampling noise.
- Fix: reject `bandHeight < DHASH_H` (8) with 409 `band_too_small`. Use the same constant phase 4 will use (`bandWindow`'s minimum), so the two phases agree.

## Low

**L1. Partial success is hidden and the list goes stale**
- Where: `chapter-workspace.tsx:842-852`
- If the top edge is learned and the bottom fails, the danger toast does not say the top was saved.
- `invalidateQueries(skipImages)` runs only when everything succeeds, so the series settings list is stale until the next refetch.
- Fix: invalidate in a `finally` block when `learned > 0`. This folds into the M1 fix.

**L2. "Thử lại" uses the `SourceItem` captured when the toast was created**
- Where: `chapter-workspace.tsx:824`
- If `it.url` is a local `blob:` URL that `use-source-images.ts:43` has since revoked (a new upload batch changes `upload.total`), every retry fails with "kiểm tra mạng".
- Fix: re-resolve the item by `it.id` from the current `sources` on each run, or fetch through the signed URL.

**L3. Clicking "Luôn cắt" removes "Hoàn tác" for the trim**
- Where: `chapter-workspace.tsx:888`
- The "Đang lưu…" and result toasts replace the trim toast. After learning, the user can no longer undo the trim from the toast. They can still re-trim by hand.
- Fix (optional): keep the "Hoàn tác" action on the result toast.

**L4. Band thumbnails are almost invisible in the grid**
- Where: `home.css:651-677`
- The grid column is about 96 px wide. An 800×30 band renders 96×3.6 px; an 800×120 band renders about 14 px.
- The rows stretch to the height of the 3/4 whole-image tiles, so a band tile is mostly empty.
- Fix: set a minimum frame height (for example, `min-height: 24px` with `object-fit` on a background), or let band tiles span 2 columns.

**L5. Rolling back the API without running down migration 0028**
- The old `creditMatcher` reads every row, so band rows (w = image width, h = band px) become whole-image fingerprints. An image with the same hash and aspect ratio (in practice, the banner itself cut out as its own file) would be auto-skipped. The old settings list would also show band thumbnails as whole images.
- The impact is small, but nothing documents it.
- Fix: add one line to the rollback notes or phase 5 docs: "API rollback past c9756f3 → run 0028 down first".

**L6. The e2e test cannot tell the band from the whole image**
- Where: `apps/web/e2e/trim-learn-band.spec.ts:12`
- Vertical stripes hash the same for the top band, the bottom band and the whole image, so the e2e would pass even if the wrong region were hashed.
- Region correctness is covered only by the stubbed unit test (`image-fingerprint.test.ts`).
- Fix (optional): make the bottom 50 px a different pattern and assert in the DB that the stored dhash ≠ the whole-image dhash.

## Unresolved
- Prod storage CORS was not probed. Dev MinIO sends `Vary: Origin`, but the prod S3 or R2 equivalent needs a one-time check that CORS is enabled and the response varies on Origin.
- Thumbnails copy the full original twice when both edges are learned. This was accepted in the spec; flagged only for storage cost on tall webtoon images.

Status: DONE_WITH_CONCERNS
Summary: 7.5/10; 0 critical, 0 high, 3 medium (edge loop aborts on terminal 409, client/server band-height race, thin bands unmatchable in P4).

## Fixes applied (commit 93cddb9)
- M1 -> each edge learned in its own try/catch (`band-learn-model.ts`, unit-tested); mixed-result message ("Đã học dải cuối; dải đầu: ảnh gần trơn."); "Thử lại" only for network/decode/5xx/not_uploaded and only for the failed edges; skip-images query invalidated after any success.
- M2 -> POST band sends `band_px` (required); server 409 `trim_changed` when it differs from the saved trim; web shows the message, no retry. API test added.
- M3 -> `MIN_BAND_PX` (= DHASH_H, 8) in `packages/shared/src/dhash.ts`; server 409 `band_too_small` below it. API test added.
- L2 -> learning resolves the image URL from the current sources list at run time; retry also re-reads current trim.
- L6 -> e2e image: only the bottom band is striped, the rest is a plain gradient, so hashing the wrong region is rejected as plain.
- `pnpm schema:emit`: no diff.
- Skipped as agreed: L1 (folded into M1), L3, L4, L5.
