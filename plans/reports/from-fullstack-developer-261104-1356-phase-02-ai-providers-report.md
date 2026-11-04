# Phase 2 report: AI providers / models / keys / slots

Status: DONE_WITH_CONCERNS (concerns = unverified OpenAI/compatible probe, see below)

## Files changed (unstaged / untracked only; nothing staged or committed)
- shared: `src/ai-providers.ts` (new; consts, zod `AiProviderInput/Patch`, `AiModelInput/Patch`, `AiSlots`, `ApiKey`, `normalizeBaseUrl`, `ProbeReason`), `src/index.ts`, `test/ai-providers.test.ts` (new).
- db: `schema/ai-providers.ts` (new), `schema/system-settings.ts` (+3 slot FK cols, RESTRICT), `schema/index.ts`, `migrations/0022_ai_providers.sql` (+ meta snapshot/journal, generated, no hand edits needed: CHECKs came from schema), `migrations-down/0022_ai_providers.down.sql`.
- api: `env.ts` (`SECRETS_KEY` optional, 43 chars + "=" + 32 bytes), `lib/secrets.ts`, `lib/ai-providers.ts` (views, pg error helper, boot `verifyProviderSecrets`), `ai/probe.ts`, `routes/admin-providers.ts`, `routes/admin-settings.ts` (GET /settings +slots, `PUT /settings/slots`), `routes/admin.ts`, `lib/system-settings.ts` (slots read/save, row lock), `index.ts` (boot verify, non-blocking).
- api tests: new `secrets.test.ts` (8), `provider-probe.test.ts` (8), `admin-providers.test.ts` (14); `vitest.config.ts` (fixed `SECRETS_KEY`), `isolate-queue.ts` (clears providers, restores `env.SECRETS_KEY` afterEach).
- web: `features/admin/{api.ts, price-suggestions.ts, provider-form-model.ts(+test), provider-form.tsx, providers-section.tsx, tasks-section.tsx, admin-sections.ts, admin-layout.tsx, admin.css}`; e2e `admin-settings.spec.ts` (+1), `env.ts` (`SECRETS_KEY`).
- config/docs: `.env.example`, `docs/deployment-guide.md` (SECRETS_KEY row, backup rule), `docs/job-queue-worker.md` (new section), `docs/design-guidelines.md`; phase file ticked/completed, plan.md phase 2 = Completed.

## Tests added / gate
- shared +18 (56), api +30 (361), web +14 (350), db 7 (unchanged). Before: shared 38, db 7, api 331, web 336.
- `pnpm typecheck`, `pnpm lint` clean; `pnpm test` all green; `db generate`: no schema changes.
- e2e: admin-settings (3, incl. new provider+slot+reload+delete-blocked flow), pipeline-settings, fonts, routes, signup: 8/8 pass.
- Tests Before: existing error-classes (ledger price) + admin-access were already green and untouched; billing not changed. admin-access auto-sweeps new routes (401/403) - passes.
- Key-leak assertions: list/create/patch/test responses and zod 400 bodies checked for plaintext, last-4-stripped key and ciphertext. Tests reset `env.SECRETS_KEY` / `ADMIN_EMAILS` in `afterEach`. Probe tests use fake fetch; the API `test` route test mocks global fetch. No network.

## Manual probe (open question 1)
Ran `probeProvider` with the real keys in `.env` (key values never printed):
- Anthropic: `x-api-key` + `anthropic-version: 2023-06-01` -> valid key 200 ok; bad key 401 auth. Confirmed.
- Gemini: header `x-goog-api-key` on `models.list?pageSize=1` -> valid 200 ok; bad key **400** classified auth (API_KEY_INVALID). Confirmed.
- OpenAI / openai_compatible: no key in `.env` -> implemented per research, **unverified live**.
- Open question 2 (prices): OpenAI pricing page re-read 2026-11-04 (WebFetch summary): gpt-4.1-mini 0.40/1.60, gpt-4o-mini 0.15/0.60, gpt-4.1 2/8, gpt-5-mini 0.25/2, gpt-5 1.25/10 - matches research. Still a summarised fetch, admin must confirm prices anyway (UI says so).

## Deviations / decisions
- Section order: Pipeline stays first (default landing + existing e2e/unit expect it); Nhà cung cấp, Model tác vụ appended.
- Edit form saves with one button: PATCH provider, then model patch/add/remove sequentially, stops at first error (earlier steps stay saved; list reloads). Chosen over per-row buttons for less UI.
- Models in the create form: extra quick-add buttons for the OpenAI price suggestions (type-in also autofills empty price fields on blur).
- `GET /providers` also returns `secrets_configured` so the UI can warn before the admin types a key.
- Slot mismatch errors: 400 `model_not_found` / `model_not_vision` with `slot`; delete/vision-off block: 409 `in_use` with `slot` (from FK constraint name) or `in_use_by_jobs {jobs}`.
- `PATCH /providers/:id` with `base_url` equal to stored (after normalisation) needs no key; non-compatible type + `base_url` -> 400 `base_url_not_supported`.
- `POST /providers/:id/test` with unreadable ciphertext -> 409 `key_unreadable` (no 500); empty model patch -> 200 no-op (drizzle would throw on empty set).
- Boot `verifyProviderSecrets` is non-blocking; in the e2e run it logs a harmless error because the API boots before the e2e DB migration (prod migrates first).
- `normalizeBaseUrl` strips query/hash/trailing slash and keeps path+port; no DNS/IP checks (as decided).
- Job-reference check uses `jsonb_each` guarded by `jsonb_typeof = 'object'`; always empty until jobs carry `payload.llm`; tested by inserting job rows by hand.
- Slots are saved but not consumed by enqueue/claim/worker yet (per scope); docs say so.
- No db migration test added (FK/CHECK behaviour covered via API tests).
- `docs/job-queue-worker.md` stale lines from phase 1 (per-user pipeline settings text) not touched, as before.

## Unresolved questions
- Verify OpenAI and a real OpenAI-compatible endpoint with the Kiểm tra button once a key is available (manual smoke from plan).
- Should the UI hide slot selects' "Có hiệu lực từ job tạo sau khi lưu" copy until claim support lands? (Currently shown; in-between builds do not apply slots.)

Status: DONE_WITH_CONCERNS

## Review fixes
Gate after fixes: typecheck + lint clean; tests shared 56, db 7, api 365 (+4), web 353 (+3); `db generate` no changes; e2e admin-settings 3/3.
- **M1** `provider-form.tsx` `saveEdit` now reloads the provider from the server first and diffs the draft against that fresh copy; order is provider PATCH -> model patches -> removes -> adds. `diffModels` matches draft rows to saved models by id, or by `model_id` when the row has no id, so a retry after a partial failure only does what is left (no `duplicate_model`), and remove + re-add of the same `model_id` becomes a price/flag patch (no delete, no duplicate). Web unit tests: partial-failure retry converges, already-deleted model untouched, remove + re-add same id.
- **L1** `PATCH /providers/:id` reads the provider `FOR UPDATE` inside the transaction; new concurrency test races two PATCHes and asserts key/base_url are never paired wrongly.
- **L2** `probe.ts` reads the body through a reader up to 1 MB then cancels; 3xx bodies are cancelled unread. Test with an endless stream (bounded pulls, cancelled) and a redirect body.
- **L3** `23503` on add-model -> 404 `not_found` (test: add to a deleted provider).
- **L4** `adminProviderRoutes.onError`: HTTP errors pass through, anything else logs only `[admin-providers]` + error names / SQLSTATE / constraint (`safeErrorSummary`), returns `{error:"internal"}`. Test forces a real DB failure (NUL in name) and asserts the 500 plus that spied console output has no key, last4, base64 blob or `api_key_enc`. Verified the test fails without the handler.
- **L6** price above 100000: specific message (limit exported as `MAX_PRICE_PER_MTOK` from shared, used by zod and the form; unit test). Kiểm tra result is bound to the provider's `updated_at` (now in the view) and hidden while its edit form is open, so editing key/base URL clears it. Deduped: `fail` now lives in `lib/ai-providers.ts` (used by admin-providers and admin-settings, the settings-only `invalid` removed); `SLOT_LABEL` exported from `api.ts` and reused by `tasks-section.tsx`.
- L5 skipped as instructed.

Status: DONE_WITH_CONCERNS
Summary: Review findings M1, L1-L4, L6 fixed with tests; gate and admin-settings e2e green.
Concerns: OpenAI / compatible probes still unverified against a live endpoint.
