# Code Review: Phase 7 (production deploy, quotas, Modal dispatcher)

## Scope
- Branch `feat/p7-production-deploy`, uncommitted diff (31 modified, ~1.1k diff lines) + untracked: budget.ts, dispatcher.ts, lib/{alert,health,request-log}.ts, routes/health.ts, schema/dispatches.ts + migration 0003 (+down), scripts/budget-resume.ts, worker/{modal_app.py, mtl_worker/dispatch_auth.py}, infra/* (systemd, Caddy, compose, 7 shell scripts), docs.
- Gates run: `pnpm typecheck` OK, `pnpm lint` (biome) OK, `pnpm test` OK (api 133, web 52, db 3, shared 8), `uv run pytest -q` 132 passed / 2 skipped, `ruff` OK, `bash -n infra/*.sh` OK (shellcheck not installed).

## Overall
Solid. Patterns match the existing code (tx helper, fenced(), DbLike, ON CONFLICT dedupe, runtime_flags), concurrency on the dispatcher is careful (xact advisory lock, HTTP call made after commit, FK-safe dispatch id), and the shell scripts handle `set -euo pipefail` well. There is one real billing bug: a budget pause refunds the attempt without bumping `providerRetries`, so the resumed run's usage is silently dropped. The Modal path has never been run and has likely packaging gaps that would fail silently.

## Critical
None.

## High

**H1. Budget pause reuses the attempt number, so the resumed run's usage is dropped from the ledger.** `apps/api/src/jobs/queue.ts:486` (`pauseForBudget`)
- `attemptNo = attempts + providerRetries` (queue.ts:44). The existing `requeue` refunds an attempt only together with `providerRetry: true` (errors.ts:29), which keeps `attemptNo` monotonic. `pauseForBudget` only decrements `attempts`.
- Failure scenario: a job is claimed with attempt 1, and a heartbeat records ledger rows `(job, attempt=1, seq=1..n)`. The budget pauses it (attempts goes to 0). After the next day resumes it, the re-claim gets `attempts=1` again, so attempt is 1 again. The worker's `JobContext._seq` restarts at 1 (runner.py:82). Every usage row of the second run hits `usage_ledger_job_attempt_seq_kind_uq` and `onConflictDoNothing` (ledger.ts:133) drops it. `attemptTotals` (ledger.ts:35) also counts the first run's tokens and GPU time against the second run's clamp.
- Impact: real LLM and GPU spend goes missing from `usage_ledger`. That under-counts the very kill-switch this phase adds, plus per-workspace usage, and it does so exactly on resumed jobs. The test (budget.test.ts:133-137) never asserts that the reclaimed attempt number differs or that ledger rows grow, so it passes.
- Fix: keep the attempt number monotonic but free. Either add `providerRetries: sql\`${jobs.providerRetries} + 1\`` in `pauseForBudget` (same pattern as `requeue`'s refund path), or don't refund and instead raise the max-attempts check. Add an assertion `again.attempt !== j.attempt` and that ledger rows from the second run land.

**H2. Modal image: the GPU execution provider will likely not load, and the fallback to CPU is silent.** `worker/modal_app.py:37`, `worker/mtl_pipeline/models.py:54-63`
- `debian_slim` plus `pip install 'onnxruntime-gpu>=1.20'` (unpinned) installs no CUDA 12 / cuDNN 9 user-space libraries, and the onnxruntime-gpu wheels need them (e.g. the `onnxruntime-gpu[cuda,cudnn]` extras or the nvidia-* pip packages). `ort_providers()` keeps only providers in `get_available_providers()`, and `InferenceSession` silently falls back to CPU when the CUDA EP fails to load. Nothing is logged.
- Failure scenario: an L4 container is billed per second while detect, mask and inpaint run on CPU. This breaks the ≤10s/page and ≤$1/1000-page acceptance criteria with no signal.
- Fix: pin the version and install the CUDA/cuDNN pip extras. After creating the session, log `session.get_providers()`. If `MTL_ORT_PROVIDERS` requests CUDA and the active providers don't include it, fail hard (exit non-zero before claiming).
- Related, unverified: `.add_local_dir(... "/app/mtl_worker")` plus `workdir("/app")` does not guarantee `/app` is on `sys.path` for `from mtl_worker.main import main` inside the Modal function (`pip_install_from_pyproject` installs only the dependencies). Set `PYTHONPATH=/app` in `.env({...})` or use `add_local_python_source`.

## Medium

**M1. `sessions/end` under-reports idle GPU because it excludes the scaledown tail and the cold start.** `worker/mtl_worker/main.py:97,160`, `apps/api/src/jobs/dispatcher.ts:179-191`
- `lifetime_s` runs from the start of `main()` until the drain exits. Modal keeps the container alive for `scaledown_window` (60s) after the input returns, and bills the image and boot time before `main()`. Each normal session therefore misses about 60s or more of L4 time. Only the killed-container reaper path adds `MODAL_SCALEDOWN_S`.
- Impact: platform GPU cost is under-counted in both the $/1000-page metric and the kill-switch.
- Fix: in `endSession`, record `lifetime - busy + MODAL_SCALEDOWN_S` (it is a known constant), or document it as a deliberate approximation.

**M2. Output guard is below `max_tokens`, so you pay up to 4096 tokens and then throw the result away.** `worker/mtl_pipeline/providers/base.py:20-24`
- The guard is 2000 but `TRANSLATE_MAX_OUTPUT_TOKENS` is still 4096 (and OCR is 2048). The spec line 25 asks for `max_output_tokens` too.
- Failure scenario: a dense page produces a 2,500-token translate response. You pay for it, `OutputTokensExceeded` fires, and the queue retries with a new attempt. The output is deterministic, so it fails again until the attempts run out and the page ends up `failed`, a regression for long pages that worked in Phase 6.
- Fix: set the provider `max_tokens` equal to the guard so the provider stops instead of overspending. Also check the 2000 limit against the largest golden-set page before shipping.

**M3. Dead `active` dispatches can stall Modal dispatch for about 1 hour.** `apps/api/src/jobs/dispatcher.ts:138, 204-224`
- A container that is OOM-killed or crashes stays `active` until `MODAL_MAX_LIFETIME_S + SCALEDOWN + 30` (about 3,690s). With `MODAL_MAX_CONTAINERS=2` and both dead, `scaleUp` is blocked (`active < max` is false) and `first` is false, so modal-mode workspaces get no worker for about 1 hour. Only the 15-minute queue-age alert fires.
- Fix: track a per-dispatch "last claim/heartbeat" timestamp (or derive it from `jobs.dispatch_id` lease activity) and treat an active dispatch with no lease activity for N minutes as ended.

**M4. Backup failures that exit via `die` never alert.** `infra/backup.sh:12-14,26,28,37`
- The ERR trap is installed after `need`/`mc_alias`, and `die` calls `exit 1`, which does not trigger ERR. So missing env vars, an empty `DATABASE_URL`, or an empty dump (`[ -s "$dump" ] || die`) leave the oneshot unit failed with no ntfy message, and `mtl-backup.service` has no `OnFailure=`.
- Fix: replace the ERR trap with `trap 'rc=$?; rm -rf "$work"; [ $rc -eq 0 ] || notify ...' EXIT` set right after sourcing lib.sh, or add an `OnFailure=` unit that calls notify.

**M5. Deploy and smoke source `shared/.env` with bash, but systemd parses the same file differently.** `infra/deploy.sh:42,74`
- `set -a; . .env` interprets `&`, `$`, backticks and spaces. A `DATABASE_URL=...?sslmode=require&...` or a secret containing `$` works under systemd `EnvironmentFile=` but breaks or mutates in bash.
- Failure scenario: smoke fails, so the deploy auto-rolls back a good release, or a value is silently truncated.
- Fix: document that every value must be single-quoted, or load the file with a small `while IFS='=' read -r k v` reader that does no expansion.

**M6. Budget sums are recomputed on every claim, heartbeat and dispatcher tick.** `apps/api/src/billing/budget.ts:27-42`, `queue.ts:83,206`
- Each call is a month-range `SUM` over `usage_ledger`, run per claim poll (Modal polls every 2s per container, Mac polls idle with backoff), per heartbeat per running job, and every 5s by the dispatcher. That is fine at MVP volume but grows linearly with monthly rows inside the claim transaction.
- Fix (later): cache the status for 5-10s in-process, or keep a daily rollup row.

## Low
- **L1.** `apps/api/src/index.ts:6`: `serve()` binds all interfaces. Security of `x-real-ip` (auth.ts:36) relies on the firewall rule in the deployment guide. Pass `hostname: "127.0.0.1"` in production so a firewall mistake cannot become rate-limit bypass via a spoofed `X-Real-IP`.
- **L2.** `worker/mtl_worker/dispatch_auth.py:37`: the 5-minute replay window has no nonce. A captured `/drain` request can be replayed and spawn extra containers under the same dispatch_id; the second `sessions/end` is then deduped and its idle cost lost. Exposure is bounded by `max_containers` and TLS. Acceptable for MVP; note it.
- **L3.** `worker/modal_app.py:75`: `drain_web` uses the full GPU worker image, so a cold start of the web endpoint can exceed the dispatcher's 15s fetch timeout (dispatcher.ts:53). The result is a false `call_failed`, a backoff bump, and an alert, while the container still starts (the late claim flips it back to `active`). Use a slim image for `drain_web`, or a 30s timeout.
- **L4.** `infra/caddy/Caddyfile:42`: `header /index.html` matches the original path, which runs before `try_files` rewrites it. Deep links such as `/w/...` get index.html without `no-cache`, so a stale index.html can reference hashed assets from a deleted release after deploy. Set the header inside the `handle` with a `>` deferred header, or match `not /assets/*`.
- **L5.** `infra/docker-compose.prod.yml:35`: `MC_HOST_local` embeds the raw secret. A secret containing `/ + @ :` breaks the healthcheck and `up --wait`. lib.sh URL-encodes the secret for exactly this reason; compose does not.
- **L6.** `infra/restore.sh:15`: under `pipefail`, `grep` finding nothing aborts inside the command substitution before the friendly `die`. Only the error message is affected.
- **L7.** `infra/deploy.sh`: there is no `flock` against concurrent deploys, and a failed `pnpm install`/build/migrate leaves a partial `releases/<x>` with no ntfy alert. `head -n -N` and `mv -T` are GNU-only (fine on the VPS, breaks on macOS).
- **L8.** `infra/smoke.sh`: if the invite gate regresses, the smoke test really creates a user in production before rolling back. Note this in the runbook.
- **L9.** `dispatcher.ts:194`: a scale-up container that finds the queue already drained by the first container reports `busy<1s` and bumps the backoff, which delays the next legitimate dispatch by 1 minute.
- **L10.** The spec says "log JSON (pino)", but the implementation uses `console.info(JSON.stringify(...))`. Functionally equivalent; this is a spec drift to note.
- **L11.** `pauseForBudget` does not call `refreshChapter`. The chapter stays `processing` while the job is paused (possibly for days), so the UI shows no budget-pause state outside ExportDialog.
- **L12.** Migration 0003 adds an FK on the existing `jobs.dispatch_id` with no cleanup step. It would fail if any dev or staging row holds a non-null orphan id. Prod is fresh, so this is an operator note only.

## Checks requested
- **(a) Code-verifiable acceptance criteria:**
  - Separate `mtl-api`/`mtl-jobs` units: met.
  - 90s cold start gives a single dispatch: met (test).
  - A Mac lease does not block Modal: met (test).
  - `GLOBAL_DAILY_USD` makes claims return no paid jobs for both Mac and Modal, and running jobs go to `paused_budget`: met. However, H1 corrupts usage accounting after resume.
  - healthz and queue-age alerts: met in code.
  - Invite-only smoke test: met.
  - Backup, restore, cost and latency criteria: not verifiable here (not deployed or measured; benchmarks doc says "CHƯA ĐO", i.e. not yet measured).
- **(b) Regressions:**
  - Claim, complete, fail, cancel, reaper: no regression found. Cancel already accepts `paused_budget` (queue.ts:556).
  - Ledger: H1.
  - Page statuses: restored correctly on pause.
  - Invite-only auth: unaffected (only the IP header changed).
  - Worker translate/OCR: M2.
- **(c) Contracts:**
  - `SessionsEndRequest` and the HTTP 403/404 errors are additive.
  - `ClaimRequest.dispatch_id` keeps its shape but is now ignored for workspace tokens (intentional).
  - Heartbeat `stop: "paused_budget"` already existed in the enum.
  - New env vars are optional except the two budget vars in production (intentional).
  - DB changes are additive with a manual down migration.
- **(d) Patterns:** consistent with existing code. `PAID_JOB_TYPES = LLM_JOB_TYPES` is an alias, not a parallel reimplementation.
- **(e) Concurrency and security:**
  - Lock order is consistent across claim, endSession and decide (jobs, then dispatches, then runtime_flags), and I found no deadlock path.
  - The claim pause uses `SKIP LOCKED`.
  - The advisory xact lock is correct.
  - The FK is guarded by `markDispatchClaimed` returning null for unknown ids.
  - HMAC uses `compare_digest`, a secret of at least 32 chars, and a timestamp check.
  - The endpoint is restricted to platform tokens.
  - Request logs carry no query, header or body. Alert messages carry no secrets.
  - Shell quoting is generally correct. Exceptions: M4, M5, L5, L6.

## Recommended actions
1. Fix H1 by bumping `providerRetries` in `pauseForBudget`, and add assertions on the reclaimed attempt number and on the ledger rows.
2. Fix H2 by pinning onnxruntime-gpu with the CUDA/cuDNN extras, failing hard on CPU fallback, and setting PYTHONPATH. Verify on Modal before turning on `DISPATCHER_ENABLED`.
3. M2: align provider `max_tokens` with the guard.
4. M1: add the scaledown tail to the idle cost.
5. M4/M5: make backup alert on every non-zero exit, and harden `.env` sourcing.
6. M3: detect dead active dispatches sooner.

## Metrics
- Typecheck: 0 errors. Lint: 0 issues (biome, ruff).
- Tests: all green. Gaps: no test for usage after a budget resume (H1), and no test for CUDA provider selection (H2).

## Unresolved questions
- Is 2000 output tokens per call enough for the densest golden-set page in a translate batch?
- Is excluding the scaledown tail from `gpu_idle_seconds` intended as an approximation?

**Score: 7/10**

Status: DONE_WITH_CONCERNS
Summary: Phase 7 code is well-structured and all gates pass, but a budget pause reuses the attempt number, which silently drops the resumed run's usage from the ledger (H1), and the Modal image likely falls back to CPU silently (H2).
Concerns/Blockers: Fix H1 before relying on the kill-switch numbers. Verify H2 on real Modal before enabling the dispatcher.
