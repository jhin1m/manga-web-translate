# Phase 3 report: learn series banner

Status: completed. Commits `c9756f3` (api/db), `d45ef43` (web + e2e); not pushed.

## Files
- DB: `packages/db/src/schema/app.ts` (`series_skip_images.edge` + check `series_skip_images_edge_chk`), migration `0028_add_series_skip_image_edge.sql` (+ snapshot, journal; applied), `migrations-down/0028_add_series_skip_image_edge.down.sql` (deletes band rows, drops check + column, pops the drizzle row).
- API: `routes/series-skip-images.ts`; test `test/series-skip-images.test.ts` (+5 cases, 13 total).
- Web: `features/upload/image-fingerprint.ts` (+ new `image-fingerprint.test.ts`), `features/series/api.ts`, `features/series/skip-images-section.tsx`, `features/home/home.css`, `features/chapter/chapter-workspace.tsx`; new e2e `e2e/trim-learn-band.spec.ts`.

## Decisions
- POST body is a strict union: `{source_file_id|page_id}` (old) or `{source_file_id, edge, dhash}`; mixing -> 400. Band path in its own `learnBand` (same row lock + tx as before); whole path shares helpers `assertRoom/assertUploaded/storeLearned`.
- Band stored row: `dhash` from client, `width` = stored `source_files.width`, `height` = `trim[edge]` from DB. No stored width -> 409 `no_hash`. Order: 404 series mismatch, 409 `no_trim`, `no_hash`, 409 `plain_image`, dedup (same edge, `sameImage`) -> `{learned:0, known:1}`, limit 100 counts all rows (whole + band), `not_uploaded`, copy + insert.
- `creditMatcher` and the whole-image dedup read only `edge IS NULL` rows; a band never blocks a whole-image learn of equal hash/ratio (test).
- Web: toast action only when trim non-null. Image source is `fetch(it.url)` -> blob; works for both the local `blob:` URL and signed URL, so no direct `uploadManager.localFiles` use. Learns each edge with `px > 0` sequentially; success "Đã học n dải" (n = learned) or "Đã có sẵn n dải…" when all existed; any failure (fetch, decode, API) -> danger toast with "Thử lại" (re-runs both edges; already-learned ones return `known`).
- `bandFingerprint` decodes the full bitmap then crops via `drawImage(bmp, sx, sy, sw, sh, 0, 0, 9, 8)` (bottom needs bitmap height, so `createImageBitmap(blob, sx,…)` is not usable without a 2nd decode). Same downscale path as `fingerprint` (shared `dhashOfRegion`), so hashes are comparable. Returns `ImageFingerprint {dhash, width, height: bandPx}`; null on decode error, `bandPx` not a positive int, or image shorter than the band.
- UI: label "Dải đầu ảnh"/"Dải cuối ảnh"; frame has `aspect-ratio: width / height`, full image abs-positioned at top (edge top) or bottom (edge bottom), overflow hidden; delete button moved to the label row. aria-label of delete: "Xoá dải … n".

## Tests
- api: 723 passed, 1 skipped (pre-existing). web unit: 498 (+4 bandFingerprint). db 8, shared 114. typecheck + lint clean.
- e2e green: trim-learn-band (new), trim-source, upload-chapter, series-manage (17). `block-panel.spec.ts:317` not run (known).

## CORS check
- Self-host: same-origin `/files/…`, no CORS needed.
- Dev MinIO (`localhost:9200`): `MINIO_API_CORS_ALLOW_ORIGIN` in `infra/docker-compose.dev.yml` = `WEB_ORIGIN`(5180) + `E2E_WEB_ORIGIN`(5181). curl with those Origins returns `Access-Control-Allow-Origin: <origin>` (+ credentials true); an unlisted origin gets none. e2e `trim-learn-band` reloads the chapter first (rail uses signed URLs, not blob) and the band fetch from the web origin succeeds. Prod compose sets the same var from `WEB_ORIGIN`; not probed (no prod access). No infra changed.

## Notes for phase 4
- `GET /series/:id/skip-images` -> `{images: [{id, edge: 'top'|'bottom'|null, width, height, url, created_at}]}`. Whole images `edge: null`. Band: `width` = image width, `height` = band px (not thumbnail height; `url` is the whole source copy). Web type `SkipImage` in `features/series/api.ts`; `LearnFrom` union exported.
- Reusable: `bandFingerprint(blob, edge, bandPx)` in `apps/web/src/features/upload/image-fingerprint.ts` (internally `dhashOfRegion(bmp, sx, sy, sw, sh)`, not exported; export it if P4 needs arbitrary regions). Client-side auto-trim must compare a candidate band at learned `height` px: hash the image's `edge` band with `bandPx = learned.height`, require `width` ratio within `sameImage` rules (`sameImage` from `@mtl/shared`, Hamming ≤ 6, ratio ≤ 5%), and skip plain hashes (`isPlainHash`). Server-side matching in `creditMatcher` ignores bands deliberately — P4 needs a separate band matcher over `edge IS NOT NULL` rows (selection by `edge`, then `sameImage({dhash, width, height: bandPx}, row)`).
- Server never sees pixels; dHash for a candidate band must come from the browser at drop time (existing `fingerprint` runs there).

## Unresolved
- Prod MinIO CORS not probed live (config-only).
- Undo-then-retry race: "Thử lại" hashes with the trim captured in the toast; if the user changed trim in between, the server (using stored trim height) could store a hash for a different height. Toast is replaced by any new toast, so window is tiny.
