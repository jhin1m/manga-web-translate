# Phase 1 report: hợp đồng + DB

## Files
- shared: `src/job.ts`, `src/series-suggestions.ts` (new), `src/index.ts`, `json-schema/job-result.schema.json` (+63), tests `shared-contracts.test.ts`, `series-suggestions.test.ts` (new)
- db: `src/schema/app.ts`, `migrations/0026_series_memory.sql`, `meta/0026_snapshot.json`, `meta/_journal.json`, `migrations-down/0026_series_memory.down.sql`

## Commands
- `pnpm schema:emit`: only job-result schema changed; new props not in `required`.
- `pnpm db:generate --name series_memory` (no `--` separator, drizzle-kit rejects it): SQL = CREATE TABLE series_suggestions, ADD COLUMN translate_memory, 2 FKs. No DROP.
- `pnpm db:migrate` OK on dev DB. Down then up tested on dev DB (table empty): both OK.
- `pnpm --filter @mtl/shared test` 83 pass; `@mtl/db test` 8 pass; `pnpm typecheck` clean; `pnpm lint` clean.

## Deviations
- Generated SQL also has FK user_id -> user (cascade) from `userId()` helper, same as other tables.
- Extra `TermKind` type export.
