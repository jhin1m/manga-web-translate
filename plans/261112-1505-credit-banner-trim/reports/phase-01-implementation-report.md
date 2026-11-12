# Phase 1 report: API + DB + worker `source_files.trim`

Status: completed. Commits: `6f57bbf` (api/db/shared), `d7405bc` (worker). Not pushed.

## Files changed
- DB: `packages/db/src/schema/app.ts` (col `trim` jsonb + check `source_files_trim_chk` on `by`), migration `0027_add_source_file_trim.sql` (+ snapshot, journal), applied via `pnpm db:migrate`.
- Shared: `job.ts` (`MIN_TRIM_KEEP_PX = 64`, `SOURCE_TRIM_SOURCES`, `SourceTrim` zod `{top,bottom,by}`), `worker-protocol.ts` (`IngestInputs.sources[].trim: {top,bottom}|null`, required key), `json-schema/inputs-chapter-ingest.schema.json` (emitted).
- API: `routes/chapters.ts` (PATCH + `sourceFileView`), `routes/pages.ts` (GET source-files), `jobs/claim-inputs.ts`, `jobs/idempotency.ts`, `jobs/enqueue.ts`, `routes/series-skip-images.ts`, `env.ts`.
- Worker: `mtl_pipeline/ingest.py` (`apply_trim`), `mtl_worker/ingest.py`, `mtl_worker/__init__.py` (0.12.0).
- Tests: `apps/api/test/{chapters,series-skip-images,queue}.test.ts`, new `test/unit/ingest-key.test.ts`, `worker-helpers.ts` (fixture VERSION 0.10.0 -> 0.12.0, required since MIN default moved), worker `test_ingest_cuts / test_export_slices / test_worker_runner / test_contract_schema`.

## Decisions
- `top+bottom == 0` stored as null and needs no height (so clearing works even for unsized images).
- Stored `height` wins over body `height`; body `height` is persisted only when the row had none.
- PATCH bound check: `height - top - bottom >= 64` else `trim_too_large`.
- `ingestKey` now takes `[{id, trim}]` (sorted after mapping); untrimmed hash is byte-identical to before (unit test locks it).
- `filesInsidePage` excludes trimmed files in the SQL query (`trim IS NULL`).
- Worker `apply_trim` is a pure fn in `mtl_pipeline/ingest.py`, clamps to keep >= 1 row, tolerates missing `trim` key (old tests' inputs unchanged).
- API test fixture `VERSION` bumped to 0.12.0 (fixture, not an assertion); added 0.11.0 -> 426 check in `queue.test.ts`.

## Results
- `pnpm typecheck`, `pnpm lint`: clean.
- `pnpm test`: web 486, db 8, api 718 passed + 1 skipped (pre-existing), shared ok.
- `cd worker && uv run pytest`: 421 passed; `ruff check` clean. Contract test green after `pnpm schema:emit`.

## For phase 2 (web)
- `PATCH /chapters/:id/source-files/:fileId` body: `{ skip?: "user"|null, trim?: {top:int>=0,bottom:int>=0}|null, height?: int>0 }`, at least one of skip/trim else 400. Response = `sourceFileView`: `{id, ord, bytes, mime, skip, trim}` with `trim: {top,bottom,by:"user"|"credit"}|null`.
- Errors: 400 `no_size` (send `height` measured in browser when the file has none), 400 `trim_too_large` (keep >= `MIN_TRIM_KEEP_PX` from `@mtl/shared`), 409 `chapter_not_draft`, 423 locked elsewhere, 404 foreign/invalid id. Error bodies `{error, message}`.
- `GET /chapters/:id/source-files` files now include `trim` (no `height` field there; chapter detail `source_files` use `sourceFileView`, also `trim`).
- Web-side zod `SourceTrim` includes `by`; API input does not accept `by` (always "user"). `by: "credit"` is only writable by server (phase 4).
- Rollout: API default MIN_PIPELINE_VERSION is now 0.12.0; workers (Mac/Modal/self-host) must be 0.12.0 before deploy.

## Unresolved
- None.
