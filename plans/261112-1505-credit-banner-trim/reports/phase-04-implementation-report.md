# Phase 4 report: auto trim on drop

Status: completed. Commit `9993098` (not pushed).

## Files
- shared: `src/dhash.ts` (`LearnedBand`, `bandWindow`, `sameBand`; uses `MIN_BAND_PX`, `MIN_TRIM_KEEP_PX`), test `test/dhash.test.ts`.
- api: `routes/chapters.ts` (`UploadFile.trim`, `creditTrim`), `routes/series-skip-images.ts` (GET items now carry `dhash`), test `test/series-skip-images.test.ts` (+4).
- web: `features/upload/image-fingerprint.ts` (`bandTrims`, `LearnedEdgeBand`, `BAND_CANDIDATES`), `upload-manager.ts` (+ `test`: new dep `autoTrims`), `upload/api.ts` (`trim` on files), `series/api.ts` (`SkipImage.dhash`), new `e2e/trim-auto-drop.spec.ts`.

## Decisions
- GET /series/:id/skip-images had no hash, so the browser could not compare: added `dhash` to the item view (additive; the thumbnail URL was already there).
- `bandWindow` returns `{sy, sh}`; `sh = round(band.height * imgW / band.width)`; null if sh < MIN_BAND_PX, kept part < MIN_TRIM_KEEP_PX, or any size <= 0. `sameBand` = Hamming <= DHASH_MAX_DISTANCE (no aspect check, window already scaled).
- `bandTrims`: candidates = fingerprinted images in first 3 (top edge) / last 3 (bottom edge); each decoded once, first matching band per edge; plain windows (`isPlainHash`) never match; second edge skipped when the kept part would fall under MIN_TRIM_KEEP_PX. Per-image decode error -> that image no trim.
- Dependency `autoTrims(seriesId, blobs, fps)` injected like `fingerprints`; production impl does `fetchSkipImages` + `bandTrims`. Any rejection is caught in `startNewChapter` -> upload as before.
- API `creditTrim`: stored as `{top,bottom,by:"credit"}` only if height known (sent with the file) and `height - top - bottom >= MIN_TRIM_KEEP_PX`; 0/0, missing height, out-of-bounds -> null for that file only (request still 201). Pixel schema `Px.min(0)` (int, <= int4 max); negative/fractional/missing key -> 400. `skip = 'credit'` (whole-image match) -> trim null.

## Undo of "Bỏ cắt"
- No code change needed for the 400 `no_size` concern: every trimmed file already has a stored height (user trim saves send the measured height, the server persists it when the row had none; credit trim requires the height at creation), and a stored height wins over the body, so undo cannot hit `no_size`. Covered by the e2e (auto-trim -> Bỏ cắt -> Hoàn tác, no error).
- Undo restores the pixels but the label becomes "Đã cắt mép" (`by: "user"`), not "Credit · tự cắt". Kept: letting the client send `by: "credit"` would widen the PATCH API for a cosmetic label. Verified in e2e (`[0, 50, "user"]`).

## Tests
- shared 120 (+7), api 727 + 1 skipped (+4), web 507 (+2 upload-manager), db 8. typecheck, lint clean.
- e2e green: trim-auto-drop (2), trim-source, trim-learn-band, upload-chapter (5). `block-panel.spec.ts:317` not run (known).
- e2e flow: learn bottom band by hand in chapter 1 -> clean chapter gets [null,null,null] -> chapter with banner gets [null,null,[0,50,"credit"]] and thumbnail "Ảnh 3 · Credit · tự cắt" -> Bỏ cắt/Hoàn tác -> Dịch chương (fake worker) -> heights [1000,1000,250] = H - band.

## Performance
- `bandTrims` on 96 synthetic 800x1200 images, 5 bands (3 top, 2 bottom, none match): ~2.5 ms (measured in Chromium via the e2e, logged line `bandTrims(96 images, 5 bands)`; asserted < 300 ms). Only <= 6 images are decoded; `fingerprintAll` for the 96 images is the existing cost and unchanged. 0 false matches on that sample.

## Notes for docs phase
- `POST /chapters` files[].trim `{top,bottom}` (optional) -> stored `by:"credit"`, dropped silently when it does not fit / no height / image credit-skipped.
- GET `/series/:id/skip-images` items now include `dhash`.
- Auto trim only looks at the first 3 images (top) and last 3 (bottom) of a dropped chapter; banner must match the learned band at the same width-scaled height; different banner height/margins -> no auto trim (trim by hand and learn again).
- Undo after "Bỏ cắt" on an auto-trimmed image labels it "Đã cắt mép".
- Not covered: perf on a real 96-image sample chapter (synthetic only); Safari.

## Unresolved
- None.
