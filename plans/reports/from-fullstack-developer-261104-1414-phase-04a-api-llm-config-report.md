# Phase 4a report: per-job LLM config via claim (API / shared / web / docs)

Status: DONE (worker half + e2e 17 left to the worker agent). Nothing staged or committed.

## Files
Shared: `src/job.ts` (`LlmRef` strict, `LlmRefs`, `llm` on 4 payloads, `model_tier` optional), `src/worker-protocol.ts` (`LlmConfig` strict, `LlmConfigs`, `ClaimedJob.llm`), `src/pipeline-settings.ts` (`proofread_tier` removed; `legacyProofreadTier`), `json-schema/{claim-response,job-payload}.schema.json` (emitted), tests `shared-contracts`, `pipeline-settings`.
DB: `schema/app.ts` (drop `llmTier`), `migrations/0023_drop_series_llm_tier.sql` (+ meta snapshot/journal, generated), `migrations-down/0023_drop_series_llm_tier.down.sql`.
API: new `ai/llm-refs.ts` (`slotRefs`, `llmFor`), `ai/llm-config.ts` (`resolveLlmConfigs`, `LlmConfigError`); changed `jobs/{enqueue,idempotency,queue,breaker,dispatcher}.ts`, `routes/{worker,series}.ts`, `billing/{prices,ledger}.ts`, `lib/system-settings.ts`, `env.ts` (MIN 0.10.0).
API tests: new `claim-payload`, `claim-llm`, `prices`, helper `llm-helpers.ts`; changed `chapters` (llm_tier), `error-classes` (clearBreaker covers per-provider keys), `worker-helpers` (VERSION 0.10.0).
Web: `pipeline-settings.tsx` (tier select removed), `series-settings-form.tsx` + `series/api.ts` (Model dịch removed), `chapter/job-error.ts` + test (AUTH_HINT), `e2e/fake-worker.ts` (0.10.0), `e2e/seed.ts`.
Docs: `job-queue-worker.md` (claim row, breaker per provider, new section "Provider AI từ DB (pipeline 0.10.0)", proofread), `deployment-guide.md` ("Checklist nâng cấp lên pipeline 0.10.0" incl. residual token risk; Modal secret note). Phase file: success criteria ticked + 04a progress note.

## Gate
- `pnpm typecheck` + `pnpm lint` clean. `pnpm test`: shared 60 (+4), db 7, api 387 (+22), web 353.
- `pnpm --filter @mtl/db generate`: no schema changes. `pnpm schema:emit` re-run: no further diff (contract test green).
- e2e run: `pipeline-settings`, `admin-settings` 4/4 pass. `full-flow/proofread/series-manage` NOT run (need worker 0.10.0 fake + step 17 worker agent).
- Key-leak asserts: claim-llm checks payload, job row, console.warn calls, `error` for key plaintext and ciphertext blob; response is the only place the key appears.

## Intentional changes to existing tests
- `worker-helpers.VERSION` 0.9.0 -> 0.10.0 (MIN_PIPELINE_VERSION bumped; old value now 426 by design).
- `chapters.test` series settings: `llm_tier` assertions replaced (field gone; legacy PATCH body with `llm_tier` -> 200, ignored, rev unaffected).
- `error-classes.test` `clearBreaker` now `like 'llm\_%'` (per-provider rows). Behaviour assertions unchanged (env key still `llm_paused`).
- `job-error.test`: strings of new AUTH_HINT.

## Deviations / decisions (reasons)
- `LlmRefs` slots all optional; `LlmRef` and `LlmConfig` are `strictObject` (key-in-payload and `vision` rejected by zod too; JSON schema already `additionalProperties:false`).
- `saveSystemPipeline` now merges `existing || new` (jsonb) instead of overwriting, so the legacy `proofread_tier` in `system_settings.pipeline` survives an admin saving Pipeline (otherwise a premium owner is silently downgraded on first save, contradicting the T13 intent). Test: claim-llm "saving the pipeline keeps the stored legacy tier".
- Claim now runs the global budget check even while a breaker pause exists (before: skipped when paused). Safer, no test impact.
- Billing algorithm (`llmPriceFor`): refs absent -> static table; >1 distinct refs -> max per dimension over refs found in DB; single ref -> that ref price if `usage.model` equals ref model, else static table (covers other slot running on env). Ref row gone -> static.
- Missing provider message uses provider id as the name (no row to read a name from).
- `retryFailedPages` untouched: its `enqueuePrepare` calls read slots per call (single-row read, same tx, FOR SHARE).
- ocr_region `input_rev` includes `llm` (via `opts`, as spec says "pageOpKey tự gồm llm"); no stale-check depends on it.
- Down 0023 re-adds `llm_tier` as `'default'` for all rows (original values not recoverable); documented in checklist step 5.
- Tests Before 3 and 4 already existed (error-classes breaker, dispatcher, chapters settings_rev t1/t3), nothing to add.

## Contract for worker (pipeline 0.10.0)

Schemas: `packages/shared/json-schema/claim-response.schema.json` (ClaimedJob incl. `llm`) and `job-payload.schema.json`; source `packages/shared/src/{job,worker-protocol}.ts`. All objects are `additionalProperties:false` -> worker must adopt the regenerated schemas (this is why API 426s workers < 0.10.0).

Claim response (`POST /worker/v1/claim`, header `Cache-Control: no-store`):
```
{ jobs: [{ id, type, attempt, lease_token, lease_expires_at, payload, inputs, outputs,
           llm?: { ocr?: LlmConfig, translate?: LlmConfig, proofread?: LlmConfig } }] }
LlmConfig (strict) = { type: "anthropic"|"gemini"|"openai"|"openai_compatible",
                       model: string(1..128), api_key: string(min 1),
                       base_url: string(url, https)|null,   // non-null only for openai_compatible
                       structured_output: "json_schema"|"json_object",
                       reasoning: boolean }
```
`llm` key is absent when the job has no DB slot. `llm.<slot>` is present exactly when `payload.llm.<slot>` is present (same slot names). No `vision` field.

Payload snapshot (stored in DB, no key): `payload.llm?: { ocr?, translate?, proofread?: { provider_id: uuid, model: string } }` on:
- `page.prepare`: `ocr` only (and only when `pipeline.ocr_engine == "llm"`)
- `chapter.translate`: `translate`
- `page.ocr_region`: `translate`, plus `ocr` when `ocr_engine == "llm"` (local OCR -> no `ocr`)
- `chapter.proofread`: `proofread`
Slot unassigned -> that key missing -> worker uses env provider for that task (as today).

Proofread legacy: `payload.model_tier` ("standard"|"premium") is now optional; present only when no `llm.proofread` (then `payload.llm` absent); with a slot there is `llm.proofread` and no `model_tier`. Worker: cfg -> `provider_for_config`; else env provider by `model_tier` (default standard).

Usage: report `usage.model` = the `model` string of the cfg actually used (ledger matches it to the ref; `page.ocr_region` with 2 refs of different models is billed at max per dimension, so one model string is fine).

Errors / breaker:
- Decrypt failure / missing provider|model never reaches the worker: API fails the job itself at claim as `auth` (message "Cấu hình AI lỗi: …"), skips it, other jobs in the same claim are still returned. Defensive: if a worker sees `payload.llm.<slot>` but no `llm.<slot>` in the claim, report `auth` (not retried) with a generic message.
- Worker error classes unchanged: provider 401/403/402/quota -> `auth` (no retry); 429 -> `rate_limited`; 5xx/timeout -> `provider`; JSON/length -> `schema`. API itself records the breaker for every distinct `provider_id` in `payload.llm` (or `env` if none) on `provider|rate_limited`; the worker sends nothing extra. 5 errors/5' of one provider pauses only that provider's jobs for 2'.
- Never put `api_key` in `fail.message`, `jobs.error`, result, heartbeat, or logs (register_secret / redact as planned).

Version: API default `MIN_PIPELINE_VERSION=0.10.0` (worker-helpers/fake-worker already bumped); worker must send `pipeline_version >= 0.10.0`. `PIPELINE_VERSION` (salt) stays 0.4.0.

## Open questions
- Smoke with real keys (OpenAI gpt-4.1-mini slot, OpenRouter, Gemini OCR, key change mid-flight, `-v` log scan) belongs to worker agent / manual step.
- Should billing prefer the matching ref by `usage.model` over max when 2 refs have different models and the worker reports the real model per call? Current: conservative max (per plan).

Status: DONE
Summary: API/shared/web/docs half of per-job LLM config done; gate green (shared 60, db 7, api 387, web 353; typecheck, lint, schema:emit clean).
Concerns: worker half + e2e full-flow/proofread/series-manage not run yet (depend on worker 0.10.0).
