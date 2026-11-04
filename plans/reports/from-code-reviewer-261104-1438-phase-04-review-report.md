# Code review: Phase 4, per-job LLM config via claim (pipeline 0.10.0)

Date: 2026-11-04 · Branch `feat/admin-settings-ai-providers` · Scope: unstaged diff + untracked (Phase 4a API/shared/web/docs,
Phase 4b worker). Phases 1–3 staged diff used only for context.

## Scope
- API: `ai/llm-refs.ts`, `ai/llm-config.ts` (new); `jobs/{enqueue,idempotency,queue,breaker,dispatcher}.ts`,
  `routes/{worker,series}.ts`, `billing/{prices,ledger}.ts`, `lib/system-settings.ts`, `env.ts`.
- Shared: `job.ts`, `worker-protocol.ts`, `pipeline-settings.ts`, emitted json-schema. DB: schema drop + 0023 up/down.
- Worker: `providers/__init__.py`, `llm_cache.py` (new), `handlers.py`, `runner.py`, `log_redact.py`, `main.py`.
- Web: tier selects removed, `AUTH_HINT`. Docs: `job-queue-worker.md`, `deployment-guide.md`.
- About 1.3k LOC changed (schema JSON included) + ~700 LOC new tests.

## Gate (re-run by reviewer)
| Check | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` (biome, 370 files) | pass, 0 issues |
| `pnpm test` | shared 60, db 7, api 387, web 353: all pass, counts match the report |
| `uv run pytest -q` | 349 passed |
| `uv run ruff check .` / `format --check` | pass / 82 files formatted |
| e2e | not re-run (implementer reported 50/50) |

## Overall assessment
The implementation is solid and tracks the spec closely. Env mode is byte-identical in idempotency keys: the test
hardcodes the pre-change formulas, including proofread `{tier}`. The key reaches only the claim response, and that
response is `no-store`. The breaker is isolated per provider and a test proves it. Billing has a single algorithm. I
found no Critical and no High issues. The findings below are one ops-doc contradiction created by a 4a/4b deviation
mismatch, and several Low edge cases.

## Critical
None.

## High
None.

## Medium

### M1. The rollback checklist promises an env fallback that the worker now explicitly refuses
- `docs/deployment-guide.md:235` (step 5): "Job có `payload.llm` → API cũ không đính `llm` vào claim → worker 0.10.0
  dùng key env (chạy được nếu env có key)."
- `worker/mtl_worker/handlers.py:83-85`: `payload.llm.<slot>` present and `claim.llm.<slot>` missing → `JobFailure("auth")`
  (04b deviation, "never silently fall back").
- Failure scenario: an operator rolls the API back. Every queued or retried job created while a slot was assigned then
  fails permanently with class `auth` and the message "thiếu cấu hình AI của job". That covers whole chapters of prepare
  and translate. The runbook says these jobs will keep running on the env key, so the operator is misled during an
  incident.
- Judgement: the worker behavior is the right default because it never silently swaps a DB key for an env key. The doc
  is what is wrong. `docs/job-queue-worker.md` already describes the guard correctly, so the two docs contradict each
  other.
- Fix: rewrite step 5 to say: "job có `payload.llm` claim bởi API cũ → worker 0.10.0 fail `auth`; sau rollback bấm
  'Chạy lại trang lỗi' (API cũ enqueue lại không `llm` → env), hoặc gỡ slot trước khi rollback để job mới không mang
  `llm`."

## Low

### L1. Breaker row locks are taken in payload order, so two failing jobs can deadlock
- `apps/api/src/jobs/breaker.ts:24` `breakerKeysOf` returns provider ids in `Object.values(payload.llm)` order. Postgres
  jsonb always orders `ocr` before `translate`. `queue.ts:706` then calls `recordProviderError`, which holds a
  `FOR UPDATE` lock on each `llm_errors:<id>` row until commit.
- Scenario: job X is `ocr_region` `{ocr:A, translate:B}` and job Y is `{ocr:B, translate:A}`, because the admin swapped
  slots between the two enqueues. If both fail with `provider` at the same time (Mac + Modal), X locks A→B and Y locks B→A.
  Postgres detects the deadlock and returns a 500 on one `/fail`, and the lease reaper eventually requeues that job. This
  is rare.
- Fix: `return ids.length ? ids.sort() : [ENV_BREAKER]`. One word.

### L2. Pricing is wrong when `ocr_region` mixes a DB slot with an env slot
- `apps/api/src/billing/prices.ts:55`: `distinct == 1` → only a ref whose model equals `usage.model` is used, otherwise
  the static table applies. The worker reports a single `usage.model` and the last `add_usage` wins
  (`runner.py:136`). For `ocr_region` that is the translate model.
- Scenario: the OCR slot is DB model X (admin price high) and translate runs on env `gemini-2.5-flash`. `usage.model` is
  the flash model, which matches no ref, so all tokens, including X's image tokens, are billed at the flash price. The
  reverse case bills env OCR tokens at the ref price. Each region job is small (a few k tokens), so the money involved is
  tiny. Phase 3 left the same imprecision in env mode.
- Fix (optional): when refs exist but the job type also uses an env slot, take the per-dimension max of the ref prices
  and `llmPrice(model)`.

### L3. Mixed `ocr_region` failures are attributed to the DB provider only
- This is accepted in the plan ("tính theo provider DB — chấp nhận"). Recording it because the test
  `claim-llm.test.ts:298` encodes the effect: while env is paused, an `ocr_region` with env OCR + DB translate still
  claims. It then hits the paused env provider, and its errors count against the DB provider. Five such errors pause a
  healthy DB provider for 2 minutes.
- Cheap fix if it ever matters: `breakerKeysOf` adds `env` when the job type has an LLM slot missing from `payload.llm`.

### L4. Redaction set has no refcount, which is latent and unsafe if jobs ever run concurrently
- `worker/mtl_worker/log_redact.py:46`: `forget_secrets` discards a key even if another in-flight job uses the same key.
  Today this is safe. `work_loop` claims `max=1` and runs jobs sequentially (`main.py` `for job in jobs: run_job`), and
  the heartbeat thread never touches providers. If concurrency is added, job A finishing would un-redact job B's key.
- Fix when needed: a `Counter` for registration and decrement on forget. Add a comment now that the module assumes
  sequential jobs.

### L5. A per-job Anthropic client still honors the `ANTHROPIC_BASE_URL` environment variable and SDK profile base_url
- `worker/mtl_pipeline/providers/__init__.py:72` constructs `anthropic.Anthropic(api_key=…, max_retries=0)` without
  `base_url`. The SDK (`anthropic/_client.py:244`) falls back to the `ANTHROPIC_BASE_URL` environment variable, then to a
  profile. Phase 3 deliberately pinned `base_url` for OpenAI against `OPENAI_BASE_URL` (`openai.py:104`, test
  `test_openai_provider.py:292`). The same threat model applies here: a stray env var on the worker host sends
  DB-managed keys to another host.
- Fix: pass `base_url="https://api.anthropic.com"` explicitly, and add a test like the OpenAI one.

### L6. The rollback order for down 0023 breaks once 0024/0025 exist
- The down file deletes `max(id)` from `drizzle.__drizzle_migrations`, which is the project convention. The plan ships
  0021–0025 in one release. "chạy down 0023 trước" with 0025 applied would delete the 0025 row and leave the 0023 row,
  so the next migrate re-runs 0025 and fails.
- Fix: when phases 6/7 land, update step 5 to "down 0025 → 0024 → 0023 theo thứ tự ngược".

### L7. Minor issues
- `ledger.ts:70`: `llmPriceFor` runs a DB query on every usage report of a slot job, including GPU-only heartbeats with 0
  tokens. Short-circuit when `llmIn == llmOut == 0`.
- `llm-config.ts:33`: when the provider is missing, the user-visible `jobs.error` shows the raw provider uuid. This is
  cosmetic.
- `test_provider_config.py::test_env_secrets_survive_job_cleanup` calls `configure_logging(False)`, which replaces the
  process root handlers in the pytest process. That is a test-hygiene side effect.

## Explicit checks requested

**(a) Success criteria**: all 6 are met in code and tests (details below). Still open: the manual real-key smoke test
(OpenAI slot, OpenRouter, Gemini OCR, key rotation, `-v` log scan), which the plan requires in the cook report. The Modal
`openai` dependency is resolved: the image uses `pip_install_from_pyproject` and `pyproject.toml:17` has `openai>=3.45`.

**(b) Backward compatibility**
- Idempotency keys:
  - prepare: `idempotencyKey(…, inputRev, {})` equals the old call because the default `options = {}` (`job.ts:327`).
  - translate: `{context}` is unchanged.
  - proofread: `{tier}` is unchanged. `legacyProofreadTier` reads `system_settings.pipeline.proofread_tier`, the same
    source and the same premium/standard mapping as `resolvePipelineSettings` before.
  - `ocr_region`: the spread `{}` changes neither the payload key order nor the hash.
  - `claim-payload.test.ts` asserts all four against hardcoded pre-change formulas.
- Old payloads and claims parse: the new fields are optional and `model_tier` became optional. Worker 0.9.0 gets 426
  (tested).
- `saveSystemPipeline` `||` merge is safe:
  - the column is `NOT NULL DEFAULT {}`, so there is no `NULL || x`;
  - every `PipelineSettings` field is required (`mask_dilation` is nullable, so it serializes as `null` and overwrites);
  - `ocr_engines` is replaced whole because the merge is top-level;
  - PUT bodies are zod-stripped, so a client cannot inject `proofread_tier`;
  - `resolvePipelineSettings` ignores unknown keys.
  - Trade-off: the legacy tier becomes invisible and immutable in the UI until a Hiệu đính slot is assigned. That is
    documented and acceptable for one version.

**(c) Key secrecy**
- The key appears only in `ClaimedJobOut.llm`, with the `no-store` header at `routes/worker.ts:49`.
- `LlmConfigError` text contains no blob or key; the test checks the job row and the `console.warn` spy.
- The worker client does not log claim bodies.
- `ContractError` messages contain the path plus the jsonschema message. For `additionalProperties`/`required` that is
  key names, not values.
- The worker cache key holds `sha256(key)[:16]` (acceptable).
- Redaction lifecycle: registered in `JobContext.__init__`, forgotten in the `run_job` `finally`, env keys kept, and
  `fail.message` redacted. The test is not phantom: it sets `RedactingFormatter` on `caplog.handler`. There is no
  concurrent-job race today (see L4).

**(d) Breaker**
- Per-provider isolation is proven both ways (A paused → B and env still run; env paused → provider jobs still run).
- The env key keeps the `llm_paused`/`llm_errors` rows.
- The dispatcher uses the same SQL.
- The budget-check-during-pause deviation is required, not just "safer". With per-provider pauses, keeping the old
  `!blockLlm &&` short-circuit would have skipped the global kill-switch for every non-paused provider's jobs. Accepted.

**(e) Billing**
- Slot jobs use the ref price and env jobs use the unchanged static table (`prices.test.ts`).
- With multiple refs the per-dimension max is used.
- There is no double charge: the change is only in the price lookup, and the seq/delta logic in `recordUsage` is
  untouched.
- Mixed-slot gap: see L2.

**(f) Migration 0023**
- It is `DROP COLUMN` only. The down migration re-adds the column with default `'default'`.
- In HEAD, `llm_tier` was used only in series routes (cosmetic), so dropping it loses no behavior.
- `translationChanged` no longer touches it, and `settings_rev` is unchanged (tested).
- Order caveat: see L6.

**(g) Worker**
- Eviction cannot close a client in use: jobs are sequential on a single thread, one job uses at most 3 entries, and
  eviction takes the LRU entry with `MAX_CACHED = 8`.
- `genai.Client`, `anthropic.Anthropic` and `openai.OpenAI` all have `close()` (verified in `.venv`).
- Provider selection per slot covers all call sites; `grep deps.provider` shows only the fallback in `llm_provider`.
- A missing config gives `auth` with no silent env fallback.
- Env-mode behavior change: a missing env key no longer stops the worker at startup; jobs fail `auth` instead. This is
  by design.

## Deviation verdicts
| Deviation | Verdict |
|---|---|
| `LlmRef`/`LlmConfig` strict | Accept: matches `additionalProperties:false` |
| `saveSystemPipeline` merge | Accept: verified safe (b) |
| Budget check during pause | Accept: required for correctness |
| Billing ref match, else static | Accept, with L2 noted |
| Missing provider → id in message | Accept (cosmetic) |
| `ocr_region` input_rev includes `llm` | Accept: no stale check depends on it |
| Down 0023 resets to `'default'` | Accept: the column was cosmetic |
| Worker `JobFailure` vs `ProviderError` for missing env | Accept |
| Payload slot without claim cfg → auth | Accept the code; fix the doc (M1) |
| `forget_secrets` instead of `clear_secrets` | Accept, with L4 |
| Cache without lock | Accept: single thread verified |

## Recommended actions
1. M1: fix rollback step 5 in `docs/deployment-guide.md`.
2. L1: sort `breakerKeysOf` ids.
3. L5: explicit Anthropic `base_url` plus a test.
4. Run the manual real-key smoke test before marking phase 4 complete.
5. Optional: L2, L4 comment, L7.

## Plan follow-ups
All 6 success criteria are satisfied in code and tests. Phase 4 remains "Pending" in `plan.md`. The lead should mark it
complete only after M1 is fixed and the manual smoke test is done. The "Tests Before" commit (step 6) has not been made,
because nothing is committed yet.

## Metrics
- Type coverage: tsc strict passes. Python ruff is clean (no mypy gate).
- Tests: +22 api, +4 shared, +13 worker. All pass.
- Lint issues: 0.

## Unresolved questions
- Is rollback with slots assigned an expected scenario? If yes, should operators unassign slots before rolling back, or
  is the "rerun failed pages" path enough?

Status: DONE
Summary: Phase 4 meets all success criteria and every gate is green. Env-mode keys, key secrecy, per-provider breaker and
billing are all verified. Findings: one doc contradiction (rollback env fallback vs worker auth guard) and Low edge cases
(lock ordering, mixed-slot pricing, Anthropic base_url env).
Score: 8.5/10 · Critical: 0 · High: 0
