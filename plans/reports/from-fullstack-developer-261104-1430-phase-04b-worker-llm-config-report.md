# Phase 4b report: worker per-job LLM config (pipeline 0.10.0)

Status: DONE. Nothing staged/committed. Manual smoke with real keys NOT run.

## Files
Worker: `mtl_pipeline/providers/__init__.py` (`provider_from_config`, `has_env_key`, `ENV_KEY_VARS`), new `mtl_worker/llm_cache.py`,
`mtl_worker/handlers.py` (`llm_provider(ctx, deps, slot)`; `run_ocr` now takes `ctx`), `runner.py` (`JobContext.llm/.secrets`,
register on init, `forget_secrets` in `run_job` finally, `fail.message` passed through `redact`), `log_redact.py` (`forget_secrets`),
`main.py` (lazy env provider, eager-load only if env key present), `__init__.py` (0.10.0 + history), `modal_app.py` (comment).
Tests: new `tests/test_provider_config.py` (12), `test_contract_schema.py` (+1). Docs: `docs/job-queue-worker.md` (worker bullet in the
0.10.0 section; 4A already covered the rest). Phase file ticked (all success criteria + 04b note).

## Gate
- worker: pytest 349 passed (336 + 13), ruff check + format clean.
- `pnpm typecheck`, `pnpm lint` clean. `pnpm test`: shared 60, db 7, api 387, web 353 (unchanged).
- e2e: full-flow, proofread, series-manage = 8/8 with fake worker 0.10.0; full `pnpm --filter @mtl/web e2e` = 50/50 passed (3.2m).

## Decisions / deviations
- Missing env key + no slot raises `JobFailure("auth", "chưa cấu hình provider AI (slot DB hoặc env worker)")` (not `ProviderError`): ProviderError.public_message() would reduce the text to "llm auth". Consequence: in `page.prepare` this error skips the partial-artifact upload (config error, nothing useful to keep).
- Extra guard (not in spec but matches contract): `payload.llm.<slot>` present but `claim.llm.<slot>` missing -> `auth`, never silently falls back to env key.
- `clear_secrets()` at job end would also wipe env-key redaction registered at startup; used new `forget_secrets(job_keys)` which keeps env keys. `fail.message` additionally redacted (defense in depth).
- `usage.model` comes from the provider actually used (OpenAIProvider/etc. already report their `model`); no extra change.
- Cache is plain module-level, no lock: only the claim loop thread builds providers (heartbeat thread never does).
- `run_ocr` signature changed (`deps` -> `ctx, deps`); only caller is handlers.
- Existing fake deps/tests unchanged (all pass without edits) - env-mode behavior unchanged.

## Open questions
- Manual smoke (OpenAI slot, OpenRouter, Gemini OCR, key rotation, `-v` log scan) still to do with real keys.
- Modal image dependency on `openai` (from phase 3) still unchecked.

Status: DONE
Summary: Worker builds providers from claim `llm` with cache, redaction, auth errors, version 0.10.0; all gates and full e2e (50/50) green.
Concerns: no real-key smoke; none else.

## Review fixes
- M1: `docs/deployment-guide.md` step 5 rewritten: jobs with `payload.llm` fail `auth` after an API rollback (worker refuses env fallback); runbook = unassign the 3 slots before rollback, then "Chạy lại trang lỗi" re-enqueues without `llm` for failed ones.
- L6: same step: run down files in reverse order from the newest migration to 0023 (generic wording).
- L1: `breakerKeysOf` returns sorted, deduped ids; new `apps/api/test/breaker-keys.test.ts` (ordering, dedupe, env).
- L5: per-job Anthropic client gets explicit `base_url`; Gemini gets explicit `http_options.base_url` + `vertexai=False` (blocks `GOOGLE_GEMINI_BASE_URL` / `GOOGLE_GENAI_USE_VERTEXAI`); test sets all SDK env vars to an evil host and asserts the clients ignore them (anthropic, gemini, openai).
- L7: missing-provider error is now generic ("nhà cung cấp AI của tác vụ đã bị xoá"), no uuid; `ledger.ts` skips `llmPriceFor` DB query when llmIn and llmOut are 0 (static price, unused); env-secret test now uses a fixture restoring root logging handlers/level. `docs/job-queue-worker.md` message updated.
- Gate: shared 60, db 7, api 389 (+2), web 353; typecheck + lint clean; worker pytest 350, ruff check/format clean.

## Accepted without change
- L2 (mixed DB+env slot pricing in ocr_region): tiny per-job amount, same imprecision as env mode; plan chose a single `usage.model`.
- L3 (mixed ocr_region failures attributed to DB provider): explicitly accepted in the plan.
- L4 (redaction set without refcount): worker is single-threaded, one job at a time (claim max=1, heartbeat thread never touches providers).
