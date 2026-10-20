# Tester report: Phase 3 job queue worker (uncommitted, worktree p3)

Branch: feat/p3-job-queue-worker. Scope: verify only, no source/test edits. Infra: mtl-dev postgres/minio up, .env present.

## Gates

| Check | Result |
|---|---|
| `pnpm typecheck` | PASS (shared, web, db, api) |
| `pnpm lint` (biome) | PASS, 82 files, no fixes |
| `uv run ruff check .` (worker) | PASS, "All checks passed!" |
| `uv run mypy mtl_pipeline mtl_worker` | PASS, 28 files, no issues |

## Tests

| Suite | Files | Tests | Result |
|---|---|---|---|
| packages/shared (vitest) | 1 | 8 | pass |
| packages/db (vitest) | 1 | 3 | pass |
| apps/api (vitest, fileParallelism false) | 8 | 50 | pass |
| worker (pytest -q) | 15 | 99 | pass, 4.7s |

`pnpm test` run twice, both exit 0:
- Run 1: api 12.26s
- Run 2: api 12.67s, same 50/50
- No flakes observed. Only 2 runs, so this is weak evidence for flake-freedom.

## Phase 3 success criteria → tests

| # | Criterion (abridged) | Covering test(s) | Status |
|---|---|---|---|
| 1 | 40-slice chapter: ingest → stage 1 → stage 2 → `review`, 0 stuck, progress via polling | `apps/api/test/worker-protocol.test.ts:48` (N=40, asserts progress counts, batch claims, final `review`) | Covered at API level. Uses 1px PNG and fake worker payloads. Real ONNX pipeline not automated (manual smoke only). |
| 2 | kill -9 worker → job rerun ≤150s; zombie `complete` → 409, no writes | `apps/api/test/worker-fencing.test.ts:103` (expire lease, reaper, requeue, fresh claim, zombie heartbeat/complete 409, ledger unchanged) | Partial. Lease 120s (`queue.ts:37`) + reaper 30s (`runner.ts:10`) = 150s worst case by arithmetic. Timing not asserted. Real process kill not automated. |
| 3 | double `complete` same lease → one ledger set; enqueue dup while active → same id; after `failed` → new job | `worker-fencing.test.ts:91`; `queue.test.ts:50` | Covered. |
| 4 | 2 workers, 1000 jobs, never same job | `queue.test.ts:65` (4 concurrent drains over 2 tokens, asserts 1000 unique ids) | Covered. |
| 5 | Continuous 429: attempts not consumed, requeue by Retry-After, breaker after 5, chapter ends `review`/`partial_failed` not `processing` | `apps/api/test/error-classes.test.ts:59` (attempts 0, runAfter ≥80s, `llm_paused` after threshold, claim blocked); `:85` (MAX_PROVIDER_RETRIES → failed, chapter `partial_failed`); `worker/tests/test_worker_runner.py:135` | Covered. The `review` ending after a 429 streak is not asserted in one test. |
| 6 | Ingest 40-slice golden KO: no cut crosses a box; re-ingest after edits → 409 | `worker/tests/test_ingest_cuts.py:83` (5 seeds, synthetic "golden-like" strip, no cut through box, `cut_flag` false); `worker-protocol.test.ts:131` (409 after user edit) | Partial. No real golden KO fixture in repo. Cut test is synthetic. |
| 7 | Re-run translate on hand-edited page: `state` kept, `ai_update_available=true`, version up | `worker-protocol.test.ts:106` (state kept, aiState set, flag true, version +2, chapter `review`); `ai-write-rules.test.ts:59` | Covered. |
| 8 | Workspace A token ≠ workspace B job; mac token ≠ `worker_mode='modal'` job | `queue.test.ts:84` | Covered. |
| 9 | 20000×20000 → `invalid_input`, no OOM | `worker/tests/test_image_limits.py:34` (side 20000 rejected from header), `:39` (16000² bomb rejected before decode), `worker/tests/test_worker_runner.py:156` (→ `invalid_input`); API side `error-classes.test.ts:164` (`invalid_input` fails page) | Covered by same rules. Exact 20000×20000 not literally tested. |

Extra coverage beyond criteria: `ai-write-rules.test.ts` (history cap, chapter lock 423, lock takeover), `worker-fencing.test.ts:157` (output rev), `worker-protocol.test.ts:43` (401 bad token), `test_contract_schema.py`, `test_handlers_cover_job_types.py`, `test_worker_runner.py` lease-lost/cancel/usage-seq/token-file perms.

## Gaps (not covered by automated test)

1. Real kill -9 of worker process + timed ≤150s recovery. Only simulated via `expireLease` + `reapExpiredLeases`.
2. Real golden KO 40-slice strip. Cut test uses synthetic strips. Real-pipeline result is manual smoke only (12 slices → 4 pages → review).
3. Real ONNX pipeline in worker is not exercised by pytest for stage 1/2 end-to-end. Worker runner tests use `FakeClient`/`FakePipeline`/`FakeProvider`, not real HTTP.
4. 429 streak ending in chapter `review` (not `partial_failed`) is not asserted in a single test.
5. Exact 20000×20000 input not tested. Equivalent rejection branch is.

## Concerns

- API suite relies on shared global DB state (reaper, breaker, `llm_paused`). Tests use filtered updates and `clearBreaker()`, and passed twice. Adding tests that call `reapExpiredLeases()` or leave breaker state may flake.
- `pnpm test` ran against the live mtl-dev DB. Test data left behind is not verified clean.
- Manual smoke evidence is not in repo; can't re-verify from this report.

## Recommendations (priority)

1. Add a timed/clock-injected test asserting lease+reaper bound ≤150s (`queue.ts:37`, `runner.ts:10`).
2. Add a golden KO fixture (or documented path) and run `test_ingest_cuts` against it, or run it in the bench suite.
3. Add one API test: 429 streak then successful retry → chapter `review`.
4. Add a worker-side test for 20000×20000 via the full `page.prepare` path, not only header check.
5. Consider one optional opt-in integration test running real pipeline on a small slice set.

Status: DONE_WITH_CONCERNS

Summary: All gates green (typecheck, biome, ruff, mypy). JS 61/61 and pytest 99/99 pass; `pnpm test` ×2 no flake. 9 criteria mapped: 5 fully covered, 4 partial (kill -9 timing, golden KO real fixture, 429→review path, exact 20000² input). No criterion uncovered outright.

Concerns:
- Kill -9 recovery and ≤150s bound not timed or process-level automated.
- Golden KO ingest test is synthetic; no real fixture in repo.
- Real ONNX pipeline only via manual smoke.
- Shared global DB state in apps/api; only 2 runs of flake check.

Unresolved questions:
- Where is the golden KO 40-slice source file (path/fixture) used for the manual smoke?
- Is there a recorded artifact for the manual smoke run to attach to the phase 3 gate?
