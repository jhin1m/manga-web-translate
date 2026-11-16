# Phase 2 report: API thumbnails + series cover

## Files changed
- New: `apps/api/src/lib/thumbnails.ts` (renderThumb/renderCover, semaphore 2, sharp.concurrency(1), 100 MP limit, ImageError),
  `apps/api/src/lib/first-pages.ts` (DISTINCT ON helpers), `apps/api/src/routes/thumbs.ts`,
  `packages/db/migrations/0029_series_cover_key.sql` (+ snapshot, journal), `packages/db/migrations-down/0029_series_cover_key.down.sql`,
  tests: `apps/api/test/{thumbs,series-cover}.test.ts`, `apps/api/test/unit/thumbnails.test.ts`.
- Edited: `packages/db/src/schema/app.ts` (series.cover_key), `packages/shared/src/storage-keys.ts` (thumb, seriesCover),
  storage drivers `types/s3-driver/disk-driver` + `storage.ts` (putObject), `routes/series.ts` (cover_src, thumb_src, cover_custom, PUT/DELETE cover),
  `app.ts` (mount), `apps/api/package.json` + `pnpm-lock.yaml` (sharp ^0.35.5), `apps/web/src/features/series/api.ts` (types only),
  `test/tenant-isolation.test.ts` (3 new routes), `test/unit/disk-driver.test.ts` (putObject).
- Phase file: status done, criteria ticked.

## sharp install
- pnpm 12 did not block it (prebuilt optional deps, no install script) -> no `allowBuilds` change.
- `node -e "require('sharp')"` OK in apps/api (darwin-arm64, vips 8.18.7).
- pnpm-lock contains `@img/sharp-linux-x64`, `@img/sharp-linux-arm64` and matching `@img/sharp-libvips-linux-{x64,arm64}` (also musl, arm, etc.) -> no `supportedArchitectures` needed. Docker multi-arch not tested (Phase 4).

## Decisions where plan was ambiguous
- DISTINCT ON helpers live in `lib/first-pages.ts` and use the raw `db` with explicit `user_id` filters (Scoped has no DISTINCT ON; routes may not import db, lib may). Series list = 1 query for covers (only series without custom cover); detail = 1 query for chapter thumbs.
- Series cover ordering: chapter number asc, then created_at/id as tiebreak, then ord. Source files are in chapters of the same user (joined on user_id too).
- `thumb_src` / `cover_src` use relative `/api/thumbs/{fileId}`; custom cover is a presigned URL (new each request).
- `cover_custom` added to `seriesView`, so POST/PATCH/GET responses carry it; `cover_src` only on list and PUT cover response; `thumb_src` only on detail chapters.
- Cover upload: `bodyLimit` (10 MB + 64 KB multipart overhead) -> 413; 400 for missing file / non-image / non png-jpeg-webp (checked via sharp metadata, GIF rejected); 422 for > 100 MP. Series lookup (404) happens before body is parsed. New key per upload; old object deleted after the DB update (failure only logged).
- Thumb route: 404 `not_uploaded` when source object missing / size outside 1..30 MB; 422 `invalid_image|image_too_large` for undecodable sources; no in-flight dedupe (per plan).
- Trim that covers whole image is ignored. `sharp.cache(false)` set to avoid libvips cache RAM.
- Tenant-isolation: added PUT/DELETE cover + GET thumbs cases; each test user gets a real 1px PNG object so the "own" control is not 404.
- No docs edited (none requested by phase).

## Measured size
- Synthetic noisy 800x6000 PNG (12.8 MB): thumb < 1 KB (noise averages out when downscaled, not representative), cover 600x800 = 55 KB. Solid-color test thumb is tiny; tests assert < 40 KB. Real manga page thumb size not measured (no real fixtures); recheck in Phase 4.

## Tests
- `pnpm --filter @mtl/api test`: 70 files, 755 passed, 1 skipped (pre-existing skip) — run before last biome format pass; re-ran affected files + unit after (27 + 205 passed).
- `pnpm --filter @mtl/db test`: 8 passed. `pnpm --filter @mtl/shared test`: 124 passed.
- `pnpm typecheck`, `pnpm lint`: clean.
- Migration on dev DB: up -> down (column gone, journal row removed) -> up OK (via docker exec psql; no host psql).

## Unresolved questions
- Cover quality/size for real pages (q75) unverified on real manga; adjust in Phase 4 if > 40 KB.
- Concurrent cover PUTs can orphan one object under `series/{id}/cover/` (cleaned on series delete) — accepted.

## Review fixes

1. **Cover query** (`lib/first-pages.ts`): `seriesCoverThumbs` and `chapterThumbs` now use `CROSS JOIN LATERAL (... ORDER BY ord, id LIMIT 1)` per chapter (raw SQL via `db.execute`, still 1 query, explicit `user_id` on both tables). Same semantics (existing tests unchanged). EXPLAIN on scratch schema (30 series x 80 ch x 50 pages, 120k rows): 8.2 ms, `Index Scan using source_files_chapter_id_ord_idx`, no spill (was 156 ms). No migration needed.
2. **Memory cap**: `renderThumb` accepts `Uint8Array | () => Promise<Uint8Array>`; the route passes `() => readObject(key)`, so the read happens inside the semaphore slot (max 2 sources buffered). Loader errors are not mapped to ImageError (stay 500). Cache-hit path (head thumb -> 302) stays outside. Deviation: `putObject` of the small WebP runs after the slot is released (holding the slot during network I/O would only cut throughput; the buffer is ~10 KB). Unit test added (peak loads, loader throw frees the slot).
3. **Stable cover URL**: `GET /api/series/:id/cover` (scoped; no cover -> 404) 302 -> `presignGet(coverKey, MAX_GET_TTL_S)`, `Cache-Control: private, max-age=600`. `cover_src` for custom cover = `/api/series/{id}/cover?v={uuid from cover_key}` in list and PUT response; per-list presigning removed. Web type comment updated. Tests: 302 + header, foreign series 404, no cover 404, URL stable across two lists and changes after new PUT; tenant-isolation got the new route (seeded cover_key for the own-control case).

Gates: api tests 760 passed / 1 skipped; `pnpm typecheck`, `pnpm lint` clean.
