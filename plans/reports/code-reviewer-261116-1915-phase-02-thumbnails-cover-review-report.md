# Code review: Phase 2 — API thumbnails + series cover

Score: **8/10** · Critical: **0** · High: 1 · Medium: 2 · Low: 4 · Fixed in review: 1 (EXIF orientation)

## Scope
- Files: `apps/api/src/lib/{thumbnails,first-pages}.ts`, `apps/api/src/routes/{thumbs,series}.ts`, storage drivers
  (`types`, `s3-driver`, `disk-driver`, `storage.ts`), `app.ts`, `packages/shared/src/storage-keys.ts`,
  `packages/db/src/schema/app.ts`, migration 0029 (+ down, snapshot, journal), `apps/web/src/features/series/api.ts`,
  tests (`thumbs`, `series-cover`, `unit/thumbnails`, `tenant-isolation`, `unit/disk-driver`).
- About 700 LOC added, not counting the lockfile.

## Gates
- `pnpm typecheck` clean · `pnpm lint` clean (496 files) · `pnpm --filter @mtl/api test`: 70 files, 755 passed, 1
  skipped (the skip was already there).
- After the review fix: api typecheck and lint clean; thumbs + series-cover + tenant-isolation 27/27; unit 207/207.
- `drizzle-kit check`: "Everything's fine". 0029 snapshot `prevId` = 0028 `id`. Apart from `series.cover_key`, the
  0029 snapshot is identical to 0028.

## Acceptance criteria (a)
| Criterion | Result |
|---|---|
| Trim top/bottom, 3:4 top crop, width 300, WebP q75 | OK (`renderThumb`). Crop height `min(H-top-bottom, round(W*4/3))`. A trim that would eat the whole image is ignored. |
| 404 when the source is missing | OK (`head(src)` null, or size outside 1..30 MB → 404 `not_uploaded`) |
| 302 + `Cache-Control: private, max-age=600` (< 900 s TTL) | OK |
| Cache hit skips sharp | OK. The test deletes the source and the second request still returns 302. |
| cover_src = first non-skip page of the lowest-numbered chapter that has one; custom cover wins; 1 `DISTINCT ON` query | Correct, but slow at scale (see High-1) |
| thumb_src per chapter | OK (1 query) |
| PUT cover validated by sharp metadata (not Content-Type); 413 / 400 / 422; old object replaced and deleted | OK. Hono `bodyLimit` buffers chunked bodies too, so it returns 413, not 400. |
| DELETE cover | OK and idempotent |
| `limitInputPixels` → 422; semaphore 2; `sharp.concurrency(1)` | OK. The slot is released in `finally` and handed straight to the next waiter (test covers a task that throws). |

## Security / tenant isolation (b)
- `/thumbs/:fileId` uses `sdb.byId` (scoped). A non-UUID id or another user's file returns 404 and no thumbnail is
  written (tested).
- `first-pages.ts` uses raw `db`, with explicit `user_id` filters on both `chapters` and `source_files`, and joins on
  `user_id`. The ids come from scoped selects. Verified, no leak.
- PUT/DELETE cover: `sdb.byId(series)` runs before the body is parsed. Another user's series returns 404 (tested,
  also covered by tenant-isolation).
- Path traversal: every storage key segment comes from DB UUIDs, integer trim values or `uuidv7()`. No user string
  reaches a key. The disk driver's `resolveKey` also rejects `..`, empty segments and anything outside `KEY_RE`.
- Disk `putObject` uses `writeAtomic`: a temp file in `<root>/.tmp` (same filesystem), a sidecar meta file, then
  `rename`. S3 `PutObjectCommand` sets `ContentType`.
- CSRF: PUT is not a CORS-simple method and the app has no CORS middleware. Same posture as the existing PATCH routes.

## No regression (c)
- Existing list/detail fields are unchanged. The additions are `cover_custom` (every `seriesView`), `cover_src`
  (list and PUT) and `thumb_src` (detail chapters). The worker never consumes `seriesView`, and there are no worker
  changes.
- Deleting a series cleans `u/{user}/series/{id}/` (cover included, tested). Deleting a chapter cleans
  `u/{user}/ch/{ch}/` (thumbs included, tested).
- Adding `putObject` to `StorageDriver` compiles everywhere.

## Migration (d)
- `0029_series_cover_key.sql`: a single nullable `ADD COLUMN`. The down file follows the 0028 convention
  (header comment, BEGIN, `DROP COLUMN IF EXISTS`, delete the max `__drizzle_migrations` row, COMMIT) and notes that
  storage objects are left behind. The journal entry is consistent.

## Fixed during review
**EXIF orientation ignored (thumb + cover)**: `apps/api/src/lib/thumbnails.ts`
- The worker decodes with `ImageOps.exif_transpose` (`worker/mtl_pipeline/images.py:52`), and trim pixels are set on
  the displayed image. sharp does not rotate by default. A probe JPEG stored landscape with orientation 6 (should
  display red on top) produced a cover with red on the left: sideways. The thumb was sideways too, and the trim was
  applied along the wrong axis.
- Fix: `sharp(src, { limitInputPixels, autoOrient: true })` in both renderers. `readMeta` now uses
  `meta.autoOrient ?? meta` dimensions for the crop math (the pixel-limit check gives the same answer either way).
- Tests: added "renderThumb EXIF" and "renderCover follows the EXIF orientation". Both fail without the fix (checked
  by temporarily reverting) and pass with it.

## High
**H1. The cover `DISTINCT ON` sorts every page row of the user's library on each home load** (`lib/first-pages.ts`
`seriesCoverThumbs`)
- Probe in a scratch schema on the dev Postgres, with 30 series × 80 chapters × 50 pages (120k `source_files`) and the
  same indexes. The current query takes **156 ms** and spills an external merge sort to disk (9 MB). It is still one
  query, but its cost grows with total pages and it runs on every list refetch (`refetchOnWindowFocus: true`,
  `staleTime: 5s`).
- The LATERAL form is still one query and takes **7.9 ms** on the same data:
  ```sql
  SELECT DISTINCT ON (c.series_id) c.series_id, f.id
  FROM chapters c
  CROSS JOIN LATERAL (
    SELECT id FROM source_files f
    WHERE f.chapter_id = c.id AND f.user_id = c.user_id AND f.skip IS NULL
    ORDER BY f.ord, f.id LIMIT 1) f
  WHERE c.user_id = $1 AND c.series_id = ANY($2)
  ORDER BY c.series_id, c.number, c.created_at, c.id;
  ```
- `chapterThumbs` (detail) took 3 ms for an 80-chapter series. A LATERAL form there is optional.

## Medium
**M1. The semaphore limits decoding but not reading the source into memory.** `routes/thumbs.ts` calls
`renderThumb(await readObject(...))`, so the whole source is buffered before the request waits for a slot. Over
HTTP/1.1 the browser keeps at most about 6 requests in flight. Behind an HTTP/2 proxy (the VPS deploy), a series
detail page with 100 chapters can queue around 100 buffers of 2–30 MB each. Fix: let `renderThumb` take a loader
(`Uint8Array | () => Promise<Uint8Array>`) and call it inside `limited()`. Do not wrap the read in an outer
`limited()`: the semaphore is not re-entrant, so that would deadlock at 2. Keep loader errors outside `asImageError`,
otherwise an S3 failure becomes a 422.

**M2. The custom cover URL changes on every list response.** The list calls `presignGet` each time, and S3
`X-Amz-Date` changes every second. Combined with refetch on focus, the browser reloads the cover image (about 15–37 KB)
and may flicker on each tab focus. Thumbs avoid this with a stable `/api/thumbs/{id}` URL plus a cached 302. Suggested
fix: add `GET /api/series/:id/cover` → 302 with the same `Cache-Control`, and have `cover_src` return that stable path
(or a path with `?v=<cover key id>` so a new cover busts the cache). Worth deciding before Phase 3 wires up the grid.

## Low
- L1. Stale thumb after a trim change: `thumb_src` stays `/api/thumbs/{id}` and the browser keeps the old 302 for up
  to 10 minutes. Could append `?t=<top>-<bottom>` to `thumb_src` in `first-pages.ts`.
- L2. The cover/thumb choice uses `source_files.skip` only. A page hidden in the editor (`pages.skipped`) can still
  be the cover. This matches the spec; noting it in case the credit page gets hidden after ingest.
- L3. Equal chapter numbers: the cover picks the older chapter (`created_at` asc), while the detail list shows the
  newer one first. Cosmetic.
- L4. No in-flight dedupe and concurrent cover PUTs can orphan objects. Both accepted in the plan, and both are
  cleaned up by the prefix delete.

## Memory and errors (e)
- sharp errors are caught inside the semaphore task and mapped to `ImageError` (422/400). Other errors propagate to
  `app.onError` (500). No floating promises. The release in `finally` is correct (tested).
  `sharp.cache(false)` is set.

## Real thumbnail size (f)
Six real webtoon strips from the dev MinIO (JPEG, 1440×10000, 1.5–2.0 MB), run through `renderThumb` /
`renderCover`:

| src bytes | thumb | time | cover |
|---|---|---|---|
| 1,502,003 | 5,262 B 300×400 | 16 ms | 14,006 B |
| 1,762,975 | 9,524 B | 20 ms | 24,246 B |
| 1,652,404 | 10,922 B | 19 ms | 29,784 B |
| 1,999,455 | 13,406 B | 19 ms | 36,178 B |
| 1,796,464 | 13,928 B | 19 ms | 36,892 B |
| 1,607,916 | 9,812 B | 16 ms | 23,768 B |

Thumbs are 5–14 KB, well under the 40 KB target. Covers are 14–37 KB. Script:
`/private/tmp/claude-501/-Users-jhin1m-Desktop-ducanh-project-manga-web-translate/6b7dd433-5ab6-4daa-9061-57c9bcb4a34c/scratchpad/measure.mts`.

## Plan follow-ups
- Every phase-02 success criterion is met. H1 is a performance follow-up, not a criterion failure. M2 should be
  settled before Phase 3 consumes `cover_src`.
- The implementer report says the real-page size was "unverified". It is now measured (table above).

## Unresolved questions
- M2: should `cover_src` become a stable API path (an API change that is cheap now and costly after Phase 3)? Needs a
  lead decision.
