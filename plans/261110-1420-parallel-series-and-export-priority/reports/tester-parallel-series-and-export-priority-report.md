# Validation report: parallel series and export priority (uncommitted changes)

Date: 2026-11-10. Branch: main. No files modified.

| # | Command | Result |
|---|---|---|
| 1 | `pnpm --filter @mtl/api test` (integration) | PASS. 57/57 files, 529 passed, 1 skipped (pre-existing), 0 failed. 60.7s |
| 2 | `pnpm --filter @mtl/api test:unit` | PASS. 11/11 files, 68 passed |
| 3 | `cd worker && uv run pytest -q` | PASS. 385 passed |
| 4a | `pnpm lint` (biome) | PASS. 432 files, no fixes |
| 4b | `pnpm typecheck` (shared, db, web, api) | PASS |
| 5a | `uv run ruff check .` | PASS |
| 5b | `uv run ruff format --check .` | PASS. 85 files formatted |
| 5c | `uv run mypy mtl_worker` | PASS. 12 source files, no issues |
| 6a | `bash -n infra/selfhost-smoke.sh` | PASS |
| 6b | `docker compose -f docker-compose.yml config -q` (MTL_WORKERS/MTL_THREADS unset) | PASS |

Failures: none. Flaky re-runs: not needed.

Build: not run (not in scope). Typecheck covers compile-level checks.

Skipped test: 1 in API integration suite, pre-existing per task brief.

Unresolved questions: none.

Status: DONE
Summary: All 10 validation commands pass on the uncommitted changes, including the full API integration suite (529 passed, 1 pre-existing skip) and worker pytest (385 passed).
Concerns/Blockers: none
