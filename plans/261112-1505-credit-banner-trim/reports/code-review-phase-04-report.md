# Code review: phase 4, auto trim on drop (commit 9993098)

Score: **5/10**. The wiring is clean: the API side is bounded and degrades per file, the upload stays safe when the bands cannot be fetched, and the gates pass. But the band hash depends on pixels outside the band in Chromium. So auto trim almost never fires on real chapters, and the only positive test passes because it uses a byte-identical image.

Gates (main tree at 9993098; the docs agent only touches docs/README): `pnpm typecheck` passes; `biome check` on the 11 touched files is clean; shared dhash 11/11, web `features/upload` 25/25, api `series-skip-images.test.ts` 17/17.

## High

### H1. The band dHash bleeds content from outside the band, so the same banner does not match across chapters
- `apps/web/src/features/upload/image-fingerprint.ts:24` (`dhashOfRegion`) is used by `bandFingerprint` (:62, learn) and `bandTrims` (:118, apply). It calls `drawImage(bmp, sx, sy, sw, sh, 0,0,9,8)` on a `willReadFrequently` canvas with `imageSmoothingQuality = "high"`. Chromium's high/medium downscale samples a mipmap of the **whole bitmap**. A 720×100 band shrunk to 9×8 pulls in rows well above the band.
- Probe: Playwright Chromium 156, an exact replica of `dhashOfRegion`, the same banner pasted under different story art. Scripts are in `/private/tmp/claude-501/-Users-jhin1m-Desktop-ducanh-project-manga-web-translate/424d1b95-0f85-406f-8dd7-53b53f8d3245/scratchpad/bandprobe/` (probe3.mjs, probe4.mjs).

  | Neighbourhood above banner (JPEG q0.85) | current (same width ×3 / 800w / 690w) | crop band first, then hash |
  |---|---|---|
  | story art touching banner | 16,14,9 / 15 / 18 | 1,1,0 / 8 / 5 |
  | 40 px white gutter | 6,7,5 / 5 / 11 | 0,0,0 / 8 / 5 |
  | 150 px white gutter | 5,5,5 / 6 / 10 | 0,0,0 / 8 / 5 |

  Even lossless PNG with identical banner pixels gives 8–13 bits; the threshold is 6. With `imageSmoothingQuality="low"` or crop-first, the same width gives 0.
- Failure scenario: a user learns the credit band from chapter 1, then drops chapter 2 with the same banner but a different last panel. No trim happens. A match only happens when the area above the band is the same as in the learning chapter. Also, `learnBand`'s dedupe (`sameImage`) sees the same banner from different chapters as new entries, so the series list fills toward `MAX_SKIP_IMAGES` with duplicates. Firefox and Safari resample differently, so a band learned in one browser may not match in another.
- The e2e hides this. In `apps/web/e2e/trim-auto-drop.spec.ts:18,71,92` the learning image (ch1 `p2`) and the target image (ch3 `p3`) use the same `banner` function at the same size, so the pixels are identical. Top-edge matching, width scaling and different neighbouring content are never tested on a positive match. The perf test only checks 0 matches.
- Fix: in `dhashOfRegion`, crop to the region before downscaling. Options: `createImageBitmap(blob|bmp, sx, sy, sw, sh)`, or draw 1:1 onto an `sw×sh` OffscreenCanvas and then shrink that to 9×8. Keep one helper so learning and applying share it. Width-scaled matches are still 5–8 bits after crop-first. Measure on real chapter pairs at 720/800 before trusting `DHASH_MAX_DISTANCE`; if needed, use a two-step downscale or a slightly wider band threshold, with a plain/false-positive check. Add a Playwright `page.evaluate` test like the perf test: same banner under different art → match; 720→800 scaled → match; unrelated bottoms → no match. Do this **before shipping**: band hashes stored with the current method stop matching after the fix. Nothing has shipped yet (not pushed), but any dev or QA series with learned bands must re-learn.

## Medium

### M1. The band match only has synthetic negative evidence
`bandTrims` (`image-fingerprint.ts:97-133`) has no test for the top edge, a chapter of ≤ 3 images (both edges on one image, with the second-edge `MIN_TRIM_KEEP_PX` guard), the plain-window skip, or first-match order. The report's "0 matches on 96 images" uses random hex bands, which says nothing about recall. Fold these into the H1 browser test.

## Low

- **L1, the optional request has no time limit.** `upload-manager.ts:180-186` → `fetchSkipImages` (`lib/api.ts:60` has no timeout or abort). A stalled GET stalls `startNewChapter`, so the spec's "không chặn upload" is not enforced. A stall here is about as likely as one on `createChapter` itself, so the risk is small. Fix: `AbortSignal.timeout(~3000)` on this call only (it is optional).
- **L2, extra wait and a second decode.** The band GET starts only after `fingerprintAll`. It could run in parallel: `Promise.all([fingerprints, fetchBands])`. Up to 6 candidates are decoded a second time with no concurrency limit (`fingerprintAll` caps at 4). For tall webtoon slices (e.g. 720×15000 is about 43 MB RGBA each), 6 at once means a temporary memory spike. Reuse `CONCURRENCY`.
- **L3, refetch per zip.** Dropping several zips calls `startNewChapter` once per zip, which refetches the same band list every time (`drop-to-translate.ts:120`). Fetch once per drop, or cache through react-query `seriesKeys.skipImages`.
- **L4, test placement.** The spec named `apps/api/test/chapters.test.ts`; the API tests landed in `series-skip-images.test.ts`. They cover the cases (bounds, missing height, 0/0, oversize/negative/fractional/missing key → 400, credit skip drops trim). This is not a problem, only noted.

## Verified OK
- (a) `bandWindow`: `sh = round(h·imgW/bandW)`; null when `< MIN_BAND_PX`, when the kept part `< MIN_TRIM_KEEP_PX`, or when a size is ≤ 0; for the bottom edge `sy = imgH - sh`. `sameBand` uses `DHASH_MAX_DISTANCE` (6), the same as the whole-image check. The math is right; only the hashing has the problem (H1).
- (b) Learning and applying use the same crop and the same 9×8 grey conversion. Both use the default `createImageBitmap` orientation (EXIF applied), which matches the worker's `exif_transpose`. Candidates are: first 3 images → top edge, last 3 → bottom edge, only images with a fingerprint; each image is decoded once. In chapters of ≤ 3 images both edges are checked, and the second edge is skipped if it would keep less than `MIN_TRIM_KEEP_PX`. A decode error only affects that image. If the API is rolled back (`dhash` missing), `hamming` throws, the per-image catch handles it, and the image is not trimmed.
- (c) `creditTrim` (`apps/api/src/routes/chapters.ts:204-208`) uses the same rule as PATCH, needs the height sent by the client, and drops the trim per file. `skip='credit'` → trim null (`:236`). Wrong client numbers are clamped by worker `apply_trim`. Claim and idempotency already include trim (phase 1); worker ≥ 0.12.0 is enforced through `MIN_PIPELINE_VERSION`. An old API ignores the `trim` key (non-strict object). The new `dhash` in GET skip-images is the user's own data and is additive; no leak.
- (d) The label, "Bỏ cắt" and "Cắt mép…" existed since phase 2. Undo after Bỏ cắt cannot hit `no_size` because the height is stored. Showing the label "Đã cắt mép" after that undo is an accepted decision.
- (e) Existing upload-manager tests are unchanged (only the new dep stub). Resume, retry and presign paths are untouched. Commit only happens when the user clicks, so an auto trim is always visible before Bước 1.

## Recommended actions
1. H1: crop before hashing in `dhashOfRegion`, measure width-scaled matches on real chapter pairs, and add a browser test with different neighbouring content plus width scaling. Re-learn any bands from dev or QA.
2. L1/L2: put a timeout on the band fetch and run it in parallel with fingerprinting; cap the decode concurrency.

Status: DONE_WITH_CONCERNS
Summary: 5/10. 0 critical, 1 high (band hash bleeds content outside the band, so auto trim does not fire on real chapters; the e2e positive case uses an identical image).
Concerns/Blockers: H1 must be fixed before release because it changes stored band hashes.

## Fixes applied
- H1 -> band hash no longer downscales a sub-rect of the full bitmap. `dhashOfBand` (one helper for `bandFingerprint` and `bandTrims`) copies the band 1:1 to its own canvas, then `grayGridFromRgba` (pure, in `packages/shared/src/dhash.ts`) area-averages it to the 9x8 grid (same luminance formula, fractional box edges weighted by area, rounded to integers so flat equal cells don't depend on float noise). Whole-image `fingerprint` untouched (unit test pins its 9x8 draw). No intermediate downscale: boxes handle any width directly.
- Measured Hamming distances in Chromium (JPEG q0.85, banner learned at 720 wide, threshold 6): bottom and top edge both: other art 0, 40 px gutter 0, 150 px gutter 0, 800 wide 0, 690 wide 0; image without the banner 29 (no match). Also through `bandTrims`: other art at 720 -> bottom 100, 800 wide -> bottom 111, no banner -> null. (Before: 5-18 bits per the probes.)
- M1 -> `bandTrims` unit tests (stubbed canvas): top edge, only first/last 3 images, chapters with one image (both edges, second cut skipped when < MIN_TRIM_KEEP_PX remains), no fingerprint / undecodable / no bands, plain window never matches (even a plain learned band), first band in list order wins, width scaling (160 -> 320 wide gives 100 px). Pure `grayGridFromRgba` tests. New e2e hash test (above). `trim-auto-drop` e2e now learns on one chapter and matches a different chapter whose art above the banner differs.
- L1 -> learned-bands GET has `AbortSignal.timeout(3000)`; any failure -> no bands.
- L2 -> bands fetch starts in parallel with fingerprinting (new dep `learnedBands`; `autoTrims(blobs, fps, bands)`); candidate decodes capped at the fingerprint concurrency (4).
- Perf after change: `bandTrims(96 images, 5 bands)` ~9.6 ms (synthetic 800x1200).
- Skipped as agreed: L3, L4. Bands learned with the earlier hash method stop matching: dev/QA series with learned bands must re-learn (nothing released).
