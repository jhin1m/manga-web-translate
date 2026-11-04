# Final regression gate: admin settings + AI providers

Date: 2026-11-04. Branch feat/admin-settings-ai-providers. 176 files staged on main 1aec051, nothing committed.

## Gate results

| # | Gate | Result | Counts (baseline main) |
|---|------|--------|------------------------|
| 1a | `pnpm typecheck` | PASS | shared, db, api, web clean |
| 1b | `pnpm lint` (biome) | PASS | 387 files, no fixes |
| 1c | `pnpm test` | PASS | api 431 (322), web 371 (333), shared 60 (38), db 8 (5) |
| 2 | `pnpm schema:emit` + `git diff --stat packages/shared` | PASS | empty diff vs index, no untracked output |
| 3 | `pnpm --filter @mtl/db generate` | PASS | "No schema changes, nothing to migrate"; no files written |
| 4a | `worker: uv run pytest -q` | PASS | 351 passed (286) |
| 4b | `worker: uv run ruff check .` | PASS | all checks passed |
| 4c | `worker: uv run ruff format --check .` | PASS | 82 files formatted |
| 5 | `pnpm --filter @mtl/web e2e` (run 1 of 1) | PASS | 55 passed, 0 failed, 0 flaky, 3.5m. DB `mtl_test_e2e` |
| 6 | Migration round-trip, throwaway DB `mtl_test_rt_261104` | PASS | up → 26 rows; down 0025..0021 each exit 0 (tracking 26→21); schema reverted (system_fonts, system_settings, ai_providers, ai_models gone; user.disabled_at gone; series.llm_tier back); up → 26 rows, all tables and columns back. DB dropped |
| 7 | Runbook SQL (docs/job-queue-worker.md, system fonts) on seeded rows | PASS | see below |
| 8 | `pnpm db:migrate` on dev `mtl` | PASS, no-op | already at 26 tracking rows (0000..0025); "migrations applied", nothing new |

Gate 7 detail. Seeded `system_fonts` `custom-1a2b3c4d` and 3 series:
- mixed `{dialogue: custom-1a2b3c4d, narration: custom-deadbeef, sfx: noto-sans}` → `{sfx: noto-sans, narration: custom-deadbeef}`
- all-in-use `{dialogue: custom-1a2b3c4d}` → `{}`
- untouched `{dialogue: noto-sans}` → unchanged
- UPDATE 2. References to the font after: 0.

## Failures

None.

## Flaky

None. E2E ran once, so no second run was needed.

## Notes and concerns (non-blocking)

1. Runbook placeholder. `docs/job-queue-worker.md` SQL uses literal `custom-xxxxxxxx`. Run as written it matches nothing (UPDATE 0), so it is safe but does nothing. I substituted a real id for the test. Operators must substitute the real id. Consider a `<font_id>` placeholder, or a note in the doc.
2. Dev DB state. Plan says `mtl` may be at 0021. It was already at 0025 (26 rows) before my run. `db:migrate` was a no-op.
3. Concurrent worktree changes, not from this gate. During the run, `README.md` and `docs/development-setup.md` changed from staged (`M ` → `MM`), and `plans/reports/from-docs-manager-261104-1544-final-docs-sweep-report.md` appeared. A docs-manager agent is active. Those edits are not included in the gate result and should be reviewed before commit.
4. Test DB leftovers. `mtl_test_api_ecda7392` and `mtl_test_db_ecda7392` exist on :5442. They are not mine and I left them. Clean up if desired.
5. Seed data in `mtl_test_rt_261104` was dropped with the DB. Nothing persisted.

## Git state

Compared git status before and after the gates. Same except for the concurrent docs changes in note 3. I did not commit or stage anything. Generated outputs from gate 2 and gate 3 were empty. The dev DB migration in gate 8 was a no-op.

## Unresolved questions

1. Should the runbook use a clearer placeholder (`<font_id>`) so operators do not run it unchanged?
2. Who owns the concurrent docs-manager edits to `README.md` and `docs/development-setup.md`? They need review before the feature commit.
3. Should the stale `mtl_test_*_ecda7392` DBs on :5442 be dropped?

Status: DONE

Summary: all 8 gates pass. Typecheck, lint, and tests are green with counts above main baseline. Worker is 351 green. E2E is 55/55 with no flakes. Migration round-trip and runbook SQL work on a throwaway DB. Dev DB was already at latest. No failures. Concern: the runbook placeholder must be substituted by the operator, and concurrent docs edits appeared in the worktree during the run.
