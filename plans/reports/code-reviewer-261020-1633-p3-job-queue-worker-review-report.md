# Code Review — Phase 3 job queue + worker (uncommitted, branch feat/p3-job-queue-worker)

## Scope
- Files: apps/api/src/jobs/*, billing/*, lib/{chapter-lock,worker-token}.ts, routes/{worker,jobs,progress}.ts, app.ts/env.ts/storage.ts diffs, packages/shared/src/{job,page-state,worker-protocol}.ts, packages/db schema + 0001 migration (+down), worker/mtl_worker/*, worker/mtl_pipeline/{ingest,schema,translate}.py, scripts/worker-token.ts, tests.
- ~3,000 LOC new TS/Py (excluding tests, generated JSON Schema, lockfiles).
- Gates: taken as green from the brief (typecheck/lint/50 api tests; ruff/mypy/99 pytest). I did not re-run them.

## Overall Assessment
The core is solid. Fencing is enforced: `lease_owner` comes from the token, and every fenced call checks lease_token, attempt, status and expiry under `FOR UPDATE`. Each claim gets its own output rev. The ledger is unique on `(job, attempt, seq, kind)` and `attempt` only goes up. Duplicate `complete` is a no-op. The AI-no-overwrite writer follows the spec. The claim uses `FOR UPDATE OF jobs SKIP LOCKED`, and a 1000-job concurrency test covers it. Tenant scoping on `/api/w/:ws` uses `sdb` and is covered by the isolation tests.

The weak point is the chapter/page state machine on the **cancel** path. It is not tested, and three different cancels leave a chapter stuck permanently in `processing` or `ingesting`. A second gap: errors in `buildInputs` happen inside the claim transaction, so one bad job can block the queue.

## Critical Issues
None found. No fencing hole, tenant leak or ledger double-count on the main paths.

## High Priority

**H1. Cancel leaves chapters stuck (`processing` / `ingesting`)**
- `apps/api/src/jobs/queue.ts:372-391` (`terminal`) together with `apps/api/src/jobs/enqueue.ts:352,359-378` (`BUSY` includes `prepared`).
  - (a) **Cancel a `chapter.translate` that is still queued.** Its pages are still `prepared`, because `markClaimed` only sets `translating` at claim. `terminal` only fails pages whose status is `translating`, so these pages stay `prepared`. `refreshChapter` treats `prepared` as busy, so the chapter stays `processing` forever and no new translate job is enqueued.
  - (b) **Cancel the last running/queued `page.prepare`** while the other pages are already `prepared`. `terminal` calls `refreshChapter(..., advance = status === "failed")`, which is `false` here. Stage 2 is never enqueued and the chapter stays `processing`.
  - (c) **Cancel a `chapter.ingest`.** `terminal` only handles `failed` for ingest, so the chapter stays `ingesting`. `refreshChapter` returns early while the status is `ingesting`, so nothing ever repairs it.
- Fix:
  - In `terminal` for `chapter.translate`, move every page in `page_ids` whose status is `prepared` or `translating` to `failed`, not just `translating`.
  - For `page.prepare`, always call `refreshChapter(..., true)`, or compute the chapter status without counting `prepared` as busy when no translate job is active.
  - For ingest, set the chapter to `partial_failed` or back to `draft` on `cancelled` as well, guarded by `ingest_rev`.
  - Add a cancel test for each of the three job types.

**H2. A bad job in `buildInputs` blocks the whole claim**
- `apps/api/src/jobs/claim-inputs.ts:63,137,152`: these paths throw a plain `Error`. That happens inside the `claim` transaction (`queue.ts:76-143`), so the route returns 500 and everything rolls back. The job is still `queued` and is still first in `priority, created_at` order, so every later claim from any worker that can run that type gets 500 again. Nothing else of that type gets claimed.
- Ways to trigger it:
  - a `chapter.translate` whose page lost `clean_rev`/`ocr_result`;
  - a `page.prepare` whose page row is gone;
  - a `page.reinpaint` whose `user_mask_key` is outside the workspace. `enqueueReinpaint` (`enqueue.ts:288-301`) never checks the key at enqueue time; it is only checked at claim (`claim-inputs.ts:152`). This turns into a real problem once Phase 5 wires up the route.
- Fix:
  - Check `keyBelongsToWorkspace` in `enqueueReinpaint`.
  - In `claim`, wrap each job's `buildInputs` in a savepoint (`t.transaction`). If it fails, mark that job `terminal(..., "invalid_input", ...)` and move on to the next job.

**H3. Re-ingest while stage 1/2 jobs are active: deadlock and cascade-deleted jobs**
- `enqueue.ts:131` only blocks a re-ingest when another `chapter.ingest` is active.
- When the new ingest completes, `applyIngest` locks the chapter and then `createIngestedPages` deletes pages (`enqueue.ts:336`). The delete cascades to the jobs table through the `(workspace_id, page_id)` foreign key.
- A concurrent `page.prepare` complete locks the job row and the page row, then waits for the chapter lock in `refreshChapter` (`queue.ts:246-258`). That is the opposite lock order, so it can deadlock. Postgres then aborts one side with a 500, possibly the ingest, which redoes the whole detect/upload.
- Even without a deadlock, running prepare jobs are deleted mid-run. Usage they report afterwards is rejected with 409 and lost. Their earlier ledger rows survive with `job_id = NULL`.
- Fix: in `enqueueIngest`, return 409 when the chapter has any active `page.prepare` or `chapter.translate`. Alternatively, cancel those jobs in the same transaction.

## Medium Priority

**M1. Retranslate failure demotes `ready` pages to `failed`**
- `queue.ts:150-155` sets the pages to `translating` at claim. Then `queue.ts:386-390`, on terminal failure, sets them to `failed`, even though their `page_states` are still valid.
- Effect: a failed re-run of the whole chapter flips a `review` chapter to `partial_failed` with every page marked failed.
- Fix: keep each page's previous status, or only fail pages that have no `ai_rev` yet.

**M2. Global circuit breaker driven by worker-reported `error_class`**
- `breaker.ts:20` together with `queue.ts:434`.
- Any workspace token can claim its own jobs and send `fail(provider)` 5 times in 5 minutes. That pauses LLM claims for **all** workspaces, including the platform/modal pool. The loop repeats because the job is requeued with its attempt refunded.
- Today this is only safe if every Mac worker is operator-owned. Before BYOK (Phase 8), scope the breaker by worker kind or by token, or only count failures from platform tokens toward the global flag.

**M3. Object-storage HEADs run inside a DB transaction that holds row locks**
- `queue.ts:201-205` (called at `:242,340,450`). Ingest complete does one sequential HEAD per page (up to `MAX_INGEST_PAGES = 1000`) while holding the chapter lock and the job lock.
- Effect: S3 latency is held inside the database lock and blocks progress polling writers and other completes.
- Fix: run the fenced pre-check and the HEADs before opening the write transaction (then re-check the fence inside it), or HEAD in parallel with a concurrency limit.

**M4. A stale translate can overwrite a newer AI state**
- `queue.ts:261-297` never compares the job's `inputRev`/`prepare_input_rev` against the current values of the pages. Two translate jobs over the same pages (rolling plus neighbors, or one from before a re-prepare) are last-complete-wins.
- An older run can overwrite `state` (when origin is `ai`) using translations of an old OCR.
- Fix: in `complete`, skip or flag pages whose `prepare_input_rev` no longer matches what the job was built from.

**M5. Progress polling query has no limit and is heavy**
- `routes/progress.ts:19` selects every job ever created for the chapter, including the `payload` column. A translate payload carries the full glossary snapshot. This runs every 2–3 s per open tab and grows with every retry.
- Fix: select only the columns needed and filter to active jobs plus the latest N.

**M6. Worker claim retry can strand leases**
- `worker/mtl_worker/client.py:57` retries `/claim` on 502/503/504. If the first claim committed and only the response was lost, the leased jobs sit unseen for 120 s.
- Each time this happens it uses one attempt (the reaper keeps the incremented count), and the third time it fails a healthy job.
- Fix: do not retry claim on a gateway error after a request that may have been sent, or have claim return the token's own still-running leases.

**M7. Ingest memory is unbounded per chapter**
- `mtl_worker/ingest.py:16-18` and `mtl_pipeline/ingest.py:132-135` hold three copies of every slice at once: the source slices, the concatenated strip, and the contiguous page copies.
- Each file is capped (16384 px, 60 MP), but the chapter total is not. Around 200 slices of 800×1280 needs roughly 2 GB on a Mac worker.
- Fix: add a cap on total pixels per chapter that fails with `invalid_input`, or process each width group separately and free it before the next.

## Low Priority
- **L1.** `queue.ts:225` with a `complete` rolled back on 400. The usage taken for that `complete` (its seq has already been consumed by `take_usage`) is lost, so the ledger slightly under-counts. The same happens when `complete` gets 409 after a cancel. Either record usage in its own transaction before validating the result, or have the worker resend it on `fail`.
- **L2.** `runner.py:127` (`restore_usage`). After all transport retries fail, if one of them had actually committed, the delta is resent under a new seq and counted twice. The clamp bounds the damage. Fix: keep the same seq on resend.
- **L3.** `scripts/worker-token.ts:54-59`.
  - The DB row is inserted before the file write. If the file already exists without `--force`, the result is an active token nobody holds.
  - With `--force`, `openSync(path, "w", 0o600)` does not change the mode of an existing file, so a 644 file stays world-readable.
  - Fix: write the file first (or check it) and `fchmod` it.
- **L4.** `routes/jobs.ts` and `routes/progress.ts` expose the worker-supplied `jobs.error` text verbatim to users. Provider response bodies can end up there.
- **L5.** `routes/jobs.ts` imports `../jobs/queue.ts`, which uses the raw `db`. That gets around the biome `noRestrictedImports` intent. It is acceptable because `cancelJob` filters by `ws`, but document it as the sanctioned pattern (similar to `inJobTx`).
- **L6.** `TextBox` renamed `font`/`size` to `font_family`/`font_size` and added `pad`, but `PAGE_STATE_SCHEMA_VERSION` stayed at 1. This is harmless now because there is no web consumer and states are empty, but any persisted Phase 2 state with `text_boxes` will no longer parse. Either bump the version or note it in the changelog.
- **L7.** The `fenced` expiry check compares the database-set `lease_expires_at` with the API's `Date.now()`. Clock skew shifts the effective lease. Use `now()` in SQL.

## Requirements / Success Criteria Check
| Criterion | Status |
|---|---|
| 40-slice chapter → review, 0 stuck, polling | Met in the e2e test (`worker-protocol.test.ts:48`), but only on the happy path. Cancel paths can get stuck (H1). |
| Kill -9 → rerun ≤150s; zombie complete → 409, no writes | Met (`worker-fencing.test.ts:103`). |
| complete ×2 → 1 ledger set; enqueue dedup / new after failed | Met. |
| 2 workers never claim the same job (1000) | Met. |
| 429 storm: attempts not consumed, Retry-After respected, breaker after 5, no stuck chapter | Met (`error-classes.test.ts:59,85`). |
| Golden KO 40-slice: no cut through a box; re-ingest after edits → 409 | Partly met. The cut test uses synthetic "golden-like" boxes, not the real detector on the golden set. The 409 path is met. |
| Retranslate an edited page keeps state, sets `ai_update_available`, bumps version | Met. |
| Workspace token A cannot claim B; Mac token skips modal | Met. |
| 20000×20000 → `invalid_input`, no OOM | Header check is tested (`test_image_limits.py`); the runner maps it to `invalid_input`. There is no full end-to-end test on a 20000² input. Chapter-level OOM is still possible (M7). |
| Requirements: `HF_HUB_OFFLINE`, models.lock check, token from file (600) or Keychain, never argv, lease 120/heartbeat 20, PUT TTL ≤ lease, 426, capability subset → 400, `worker_mode` filter | Met. |
| Deferred | `paused_budget` / budget check at claim, `dispatches`, `/healthz` (Phase 7); `chapter.export` handler (Phase 6). These are documented in `docs/job-queue-worker.md`. |

## Edge Cases Found by Scouting
- Cancel × {queued translate, last prepare, ingest} → stuck chapter (H1). Not tested.
- Re-ingest while stage 1 is running: lock-order inversion and cascade-deleted jobs (H3).
- Poison job at the head of the queue (H2).
- Overlapping translate jobs over the same pages (M4).
- Lost claim response (M6).

## Recommended Actions
1. Fix H1 (terminal/cancel state transitions) and add cancel tests for ingest, prepare and translate.
2. H2: validate `user_mask_key` at enqueue, and isolate each job's `buildInputs` failure inside claim.
3. H3: block re-ingest while stage 1/2 jobs are active.
4. M1 and M4 (status demotion, stale translate), then M3 and M5 (I/O inside the transaction, polling query).
5. Decide the trust model for M2 before Phase 7/8.

## Metrics
- Type coverage: strict TS. There are some `as` casts (`queue.ts:135-136,339`); they are justified.
- Test coverage: the main fencing/queue/AI-write paths are covered. Cancel, re-ingest-while-active and poison-job paths are not.
- Lint: reported clean.

## Unresolved Questions
- Who runs Mac workers: the operator, or the tenant? This decides whether worker-reported usage and `error_class` can be trusted (M2, and under-reporting `calls` reduces billed tokens).
- On user cancel of an ingest, should the chapter go back to `draft` or to `partial_failed`?

**Score: 7/10**

Status: DONE_WITH_CONCERNS
Summary: Fencing, ledger idempotency, the AI-no-overwrite rule and tenant scoping are correct and tested. Cancel paths leave chapters stuck, and claim can be blocked by a single bad job.
Concerns: H1 (three cancel paths stuck), H2 (a bad job blocks claims), H3 (re-ingest during active jobs deadlocks or deletes jobs); none of these is tested.
