# Test report: phase 7 uncommitted changes (feat/p7-production-deploy)

Worktree: /Users/jhin1m/Desktop/ducanh-project/mtl-wt/p7. No source/test files modified. Dev Postgres/MinIO untouched.

## Test results overview

| Suite | Result |
|---|---|
| `pnpm typecheck` (5 pkgs) | PASS, 0 errors |
| `pnpm lint` (biome, 180 files) | PASS, no fixes needed |
| `pnpm test` (wall 25s) | PASS |
| - packages/shared (vitest) | 8/8 |
| - apps/web (vitest, incl. font sync check) | 52/52 (9 files) |
| - packages/db (vitest) | 3/3 |
| - apps/api (vitest, 17 files) | 133/133 |
| worker `ruff check .` | PASS |
| worker `ruff format --check .` | PASS (56 files) |
| worker `mypy mtl_worker mtl_pipeline` | PASS (30 files) |
| worker `pytest -q` (1.4s) | 132 passed, 2 skipped |
| `python3 -m py_compile worker/modal_app.py` | PASS |
| `bash -n infra/*.sh` (7 scripts) | PASS |
| `shellcheck -x infra/*.sh` | NOT RUN, shellcheck not installed |

Skipped (pytest): `tests/test_inpaint.py` (weight `big_lama` missing), `tests/test_tiling_merge.py` (weight `rtdetr_v2_comic` missing). Environment skips, so inpaint and tiling merge are not exercised here.

Total: 196 JS tests + 134 Python tests. Default-order runs: API x3 (2 via `pnpm test`/`pnpm --filter`, 1 verbose), all green.

## Flakiness and order dependence (apps/api)

Default order: green in 3/3 runs (23-25s each).

Shuffled order (`vitest run --sequence.shuffle --sequence.seed=N`), NOT green:

| Run | Failed tests | Failing files |
|---|---|---|
| seed 12345, full | 17/133 | export, chapters, ai-write-rules, worker-fencing, worker-protocol, find-replace, error-classes |
| seed 999, full | 11/133 | worker-protocol, error-classes, ai-write-rules, find-replace, export |
| seed 12345, excl. budget+dispatcher | 18/115 | same family (chapters, queue added) |
| seed 999, excl. budget+dispatcher | 12/115 | same family |

- New files `budget.test.ts` and `dispatcher.test.ts` PASSED in both shuffled full runs. Excluding them does not remove the failures, so they are not the root cause.
- Failure signatures are shared-DB state leaks: chapter lock held by another user (`holder: 'u3'`), "no pages", `undefined` job rows, stale statuses (409 vs 410/302/423/200).
- None of the 7 failing-file families is modified in this diff (no `test/*.ts` other than the 2 new ones changed; `helpers.ts`/`worker-helpers.ts` unchanged). Pre-existing isolation debt. Src changes could still shift timing; no HEAD baseline run done (would need a worktree, not created).
- `vitest.config.ts` already uses `fileParallelism: false`; cross-file state is the issue, not parallelism.

Python: single run only (`-q`, 132 pass). Random order not checked.

## Coverage

Line/branch/function % NOT measured. Root `package.json` has no `test:coverage` script and none was requested. Assessment below is by reading the tests against code.

### New behavior vs tests

**budget.ts** (`budget.test.ts`):
- Covered: budgetStatus with no limits, limit 0 = exceeded; claim blocks paid jobs (Mac + Modal); queued paid → paused_budget; heartbeat stop + attempt refund + page→pending + 409 on stale worker; non-paid job unaffected; resume after lift (`maintainBudget`); alerts 50/80/100 once per period; ntfy failure does not throw.
- Gaps: positive-limit real-spend exceeded path (only limit 0 + synthetic `BudgetStatus` used); daily window boundary (yesterday's rows excluded from daily, included in monthly) not asserted; `pauseQueuedPaidJobs` `skipLocked` behavior (row locked by another tx left queued) untested; alert `limitUsd === null` skip untested.

**dispatcher.ts** (`dispatcher.test.ts`):
- Covered: idle/mac-only no dispatch; first dispatch; no re-fire during cold start; no_claim + backoff 1'→2'; late claim → active; scale-up gating (age, pending, max containers); empty-container backoff; mac lease does not block modal; budget block; drain-call failure → no_claim; unknown dispatch_id ignored; sessions/end 403/200/duplicate/404, clamp; reaper killed container + late report no-op; HMAC vector; healthz 503/200.
- Gaps:
  - `callModalDrain` (real HTTP) never exercised: URL/headers, `x-mtl-signature` header wiring, 15s abort, non-2xx throw, missing-env throw. Only injected fakes + `signDrainBody`.
  - `dispatchTick` advisory-lock `locked` branch (two concurrent ticks) untested.
  - `decide` with `isLlmPaused` (types filter) untested.
  - `noClaim` alert and "Gọi Modal thất bại" alert: not asserted (`sendAlert` not spied).
  - `endSession`: `busy_s > lifetime_s` clamp, `busy < MIN_BUSY_S` boundary (0.5s), and late `/sessions/end` on a `no_claim` dispatch untested.
  - `markDispatchClaimed` on an `ended` dispatch (job still gets `dispatchId`, status unchanged) untested.
  - Workspace token sending `dispatch_id` in `/claim` (ignored branch) untested.

**queue.ts claim/heartbeat budget + dispatch**:
- Covered: claim budget gate, heartbeat gate for paid job types, `pauseForBudget` for `page.prepare`.
- Gaps:
  - `pauseForBudget` `chapter.translate` branch (ready vs prepared restoration by `aiRev`, `page_ids`) untested. Only `page.prepare` tested.
  - Claim-time `pauseQueuedPaidJobs` for queued `chapter.translate` untested.
  - Heartbeat on a `cancelled` job while budget exceeded (cancel precedence) untested.
  - Claim with budget exceeded and only paid types requested: returns `[]` after `markDispatchClaimed` already ran, untested.

**health.ts** (`apps/api/test/dispatcher.test.ts` "healthz" block):
- Covered: runner missing → 503; runner stale (5 min) → 503; all-up → 200 with `oldest_queued_age_s: null`.
- Gaps: DB-down branch (`db=false`, `runner=false`, `age=null`) untested; storage-down branch (`storage=false`) untested; non-null `oldest_queued_age_s` and `Math.round` untested; `RUNNER_STALE_S` boundary (89s vs 91s) untested. Test also depends on live MinIO for `storage: true`.

**worker/mtl_worker/main.py work_loop** (`test_worker_drain.py`):
- Covered: drain exits after idle window with busy time counted; empty-queue drain exit; loop `--once` on empty queue; `sessions/end` + `dispatch_id` wire format; `dispatch_auth` verify (fresh, tamper, skew, bad secret, bad uuid, bad body).
- Gaps:
  - `PipelineTooOld` → return 3 untested.
  - `AuthError` → return 2 untested.
  - Generic claim exception in drain mode (`drained()` inside except, backoff) untested.
  - `stopping` event set mid-loop (SIGTERM path inside work_loop) untested.
  - `once=True` with a non-empty batch (return after one batch) untested.
  - `main()` untested: missing `--api` → 2, drain without `--dispatch-id` → 2, `TokenError` → 2, `report_session_end` exception swallowed, `sessions/end` only when `dispatch_id` set, `MTL_DRAIN_IDLE_S` default.
  - Drain-loop tests use short real timers (0.01s poll, 0.05-0.1s idle). Assertions are loose (`>=`), so low flake risk, but timing-based.

**worker/mtl_pipeline/providers/base.py guard** (`test_worker_drain.py`):
- Covered: `guard_output_tokens` boundary (2000 ok, 2001 raises, usage kept); Anthropic `ocr_page` over-guard → `OutputTokensExceeded`, no in-job retry, 3000 tokens billed.
- Gaps:
  - Gemini guard (`providers/gemini.py:76`) untested.
  - `translate_batch` over-guard path and `translate.py:99` (`retry_in_job` False → no retry) untested. OCR path only.
  - `OUTPUT_TOKENS_GUARD` env override (`MTL_MAX_OUTPUT_TOKENS_PER_CALL`) untested.

**worker/mtl_worker/dispatch_auth.py + modal_app.py `/drain`**:
- Covered: `dispatch_auth.verify` in pytest; same HMAC vector in API and worker tests (cross-language contract).
- Gaps: `drain_web` (401 on bad sig, 202 + `drain.spawn`) has no test; only py_compile. Also: `MAX_SKEW_S` (300s) allows a replayed signed `/drain` within 5 minutes to spawn another container. Bounded by `max_containers` and budget gate, not dispatch-id-deduped. Design choice, flag only.

## Performance

- API suite: ~24s, 133 tests. Slowest: `queue.test.ts` 2-worker 1000-job concurrency, 2120ms. Next: `error-classes` 429 breaker test 293ms, `dispatcher` scale-up 380ms, `budget` exceeded 388ms, `dispatcher` sessions/end 363ms.
- Worker pytest: 1.4s.
- `budgetStatus` runs on every claim, every heartbeat, and every 5s dispatcher tick. Aggregates `usage_ledger` for the month. `usage_ledger_created_idx` exists (`0003_dispatches_budget.sql`), so the scan is index-backed. Not load-tested.

## Build status

- Typecheck, lint, ruff, mypy: clean.
- No warnings reported by any tool run.
- `modal_app.py` compiles.
- Infra shell: `bash -n` clean. shellcheck NOT run (not installed; not installed by me).

## Critical issues

None blocking. Default-order suite green; new budget/dispatcher suites green under shuffle.

## Concerns

1. Shuffled-order failures in pre-existing API suites (chapters, export, find-replace, worker-protocol, error-classes, ai-write-rules, worker-fencing). Default order hides it. CI is green only because order is stable. Not caused by new tests.
2. Budget and dispatcher `resetGlobalState`/cleanup touch global DB state (cancel all queued jobs, delete all dispatches and backoff flags, reset env). Same family of leak. Passes today, but any future file that relies on queued jobs surviving would break.
3. Paid-path guard coverage is OCR/Anthropic only. Gemini and translate guards untested.
4. Drain endpoint (`modal_app.drain_web`) has no behavioral test.

## Recommendations

1. Add a shared per-file DB reset in `apps/api/test/helpers.ts` / `global-setup.ts` (cancel queued jobs, release chapter locks, clear dispatch/budget flags) so suites are order-independent. Then add a shuffled run to CI.
2. Test `callModalDrain` with a stubbed `fetch`: URL, `x-mtl-signature` header matches body, non-2xx throws, missing env throws.
3. Add `chapter.translate` case to `pauseForBudget` tests (ready/prepared restoration).
4. Add `budgetStatus` daily-window boundary test (seed a ledger row from yesterday UTC) and a positive-limit exceeded test with real spend.
5. Worker: `work_loop` tests for `PipelineTooOld` (3), `AuthError` (2), and SIGTERM via `stopping`. Test `main()` argument validation.
6. Gemini guard test mirroring the Anthropic one; `translate_batch` guard + no-retry test.
7. Test `drain_web` with the FastAPI test client: 401 on bad signature, 202 + spawn on good.
8. Install shellcheck and run `shellcheck -x infra/*.sh`. Not done here.
9. Optional: add `test:coverage` script and record line/branch baseline for `budget.ts`, `dispatcher.ts`, `health.ts`.

## Next steps (priority)

1. Install shellcheck; run it on `infra/*.sh`.
2. Fix test-isolation (rec 1); re-run shuffled order until green.
3. Close high-value gaps: `callModalDrain`, `chapter.translate` pause branch, `drain_web`, work_loop error exits, Gemini/translate guard.
4. Coverage baseline for the new modules.

## Unresolved questions

- Are the shuffle failures present at HEAD (before this diff)? Not checked; would need a clean worktree run.
- Is replay of a signed `/drain` within 300s acceptable? Currently it spawns a container. Design call, not a test failure.
- Should the health test be made independent of live MinIO (`storage` check mocked)? Currently it passes only because dev MinIO is running.

Status: DONE_WITH_CONCERNS
Summary: All required gates green (typecheck, lint, 196 JS tests, ruff, mypy, 132 pytest, py_compile, bash -n). New budget/dispatcher/drain tests pass in default and shuffled order, but the older API suites fail under shuffled order (11-17 tests), and several new-behavior paths are untested.
Concerns/Blockers: shellcheck not installed, so infra scripts were only syntax-checked. Shuffle failures are pre-existing isolation debt, not confirmed against HEAD.
