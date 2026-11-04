# Code Review: Phase 2 (AI providers / models / keys / slots)

Date 2026-11-04 · branch `feat/admin-settings-ai-providers` · scope = unstaged diff + untracked files outside `plans/`
(staged Phases 1 and 3 used only for context).

## Scope
- Files: shared `ai-providers.ts` (+test); db `schema/ai-providers.ts`, `schema/system-settings.ts`, `0022_ai_providers.sql`
  (+snapshot/journal), `migrations-down/0022_ai_providers.down.sql`; api `env.ts`, `index.ts`, `lib/secrets.ts`,
  `lib/ai-providers.ts`, `lib/system-settings.ts`, `ai/probe.ts`, `routes/admin-providers.ts`, `routes/admin-settings.ts`,
  `routes/admin.ts`, tests (`secrets`, `provider-probe`, `admin-providers`, `isolate-queue`, `vitest.config`); web
  `features/admin/*` (providers/tasks sections, form, form model + test, price suggestions, api, css), e2e; docs.
- About 340 changed lines in tracked files plus about 1.6k new lines.
- How I checked it: read every changed file and compared it with the plan (D1–D8, T4–T7, T18) and the phase-02 spec, plus
  three runtime checks (below).

### Runtime checks I ran
1. **Gate**: `pnpm typecheck && pnpm lint && pnpm test` passed (exit 0). Counts: shared **56**, db **7**, api **361**, web **350**
   (36 api files, 44 web files). These are the expected counts. Biome checked 364 files and found nothing.
2. **Migration 0022 up → down → up** on a throwaway DB (`mtl_test_review0022_*`, dropped afterwards). Deleting a provider whose
   model is in a slot fails with `23503`, constraint `system_settings_translate_model_id_ai_models_id_fk`, so `slotOfConstraint`
   parses it correctly. A compatible provider without `base_url` fails with `23514`. The down file removes the 3 slot columns
   and both tables and deletes exactly one journal row. Running the migrations again re-applies 0022 cleanly.
3. **Zod echo check** (scratch vitest): I sent the key through the superRefine issue (compatible without base_url), a regex
   failure (non-ASCII key), an extra unknown key, a `base_url` containing `user:key@`, duplicate models, and a patch with a
   spaced key plus an `http` URL. None of the issues JSON contains the key. Zod 4 strips `input` from issues.

## Overall assessment
The backend matches the spec and is mostly correct.
- **Encryption follows T4 exactly**: version byte 0x01, a fresh 12-byte IV from `randomBytes` on every call, 16-byte tag checked
  by `setAuthTag` and `final`, AAD `ai_provider:<id>`, unknown version rejected before decryption, error carries only a code,
  and the key is not memoised.
- **Slot integrity is enforced by the database**: FK `RESTRICT` columns. The 3 write paths (PUT slots, DELETE provider/model,
  PATCH vision) are serialised by a `FOR UPDATE` lock on the settings row.
- **The probe never sends the key anywhere unexpected**: key only in headers, `redirect: "manual"`, `AbortSignal.timeout(10s)`,
  all fetch errors swallowed into `network`, and the response body is never returned.
- **All new routes are admin-only**: they sit behind `requireUser` + `requireAdmin` and the existing `admin-access` sweep
  covers them.

No Critical or High findings. The main defect is in the web edit flow: a save that fails partway through cannot be retried.

## Critical Issues
None.

## High Priority
None.

## Medium Priority

### M1. Retrying a provider edit that failed partway always fails with `duplicate_model`
`apps/web/src/features/admin/provider-form.tsx:27-36,48-58` + `providers-section.tsx:127-133`

**Cause.**
- `saveEdit` runs PATCH provider → PATCH models → POST new models → DELETE removed models, and stops at the first error.
- `onSettled` reloads `providersKey`, so the `saved` prop gets fresh data.
- The form keeps `key={editingProvider.id}`, so its `useState` draft is not rebuilt. Models added in that draft still have no
  `id`.

**What the admin sees.**
1. Edit provider: add `gpt-5` and remove `gpt-4.1-mini`, which is assigned to OCR. Press Lưu.
2. PATCH succeeds, POST `gpt-5` succeeds (201), DELETE `gpt-4.1-mini` returns 409 `in_use`. The form stays open with the error.
3. The admin unassigns OCR in another tab, or decides to keep the model, and presses Lưu again. `diffModels(d, freshSaved)`
   posts `gpt-5` again, gets 409 `duplicate_model` ("Model này đã có trong nhà cung cấp."), and stops before the DELETE.
4. The admin cannot recover without pressing Huỷ and reopening the form.

A related case: because adds run before removes, removing a saved model and adding the same `model_id` again also returns 409.

The implementer listed sequential saving as a deviation. I accept sequential saving itself, but this follow-up bug was not
handled.

**Fix (any one of these):**
- (a) In `onSettled` / `onError` when `saved` is set, rebuild the draft from fresh data while keeping the typed key. For example,
  give the form a `key` that includes a revision counter bumped on error, or re-run `draftOf`.
- (b) In `saveEdit`, skip adds whose `model_id` already exists in `saved.models`, and run `remove` before `add`.

Also add a unit test for "retry after a partial failure produces an empty or remaining-only diff".

## Low Priority

### L1. `PATCH /providers/:id` reads the row without a lock (TOCTOU on the `key_required` check)
`apps/api/src/routes/admin-providers.ts:142-160`

`providerById` is a plain SELECT, so the check `body.base_url !== cur.baseUrl && !api_key` runs against data that may already be
out of date.

**Scenario:**
1. Request A sends `{base_url: B, api_key: K2}`. Request B, sent at the same time, contains `{base_url: A}`, which is the
   *old* URL, so it needs no key.
2. B reads `cur = A` and passes the check. Its UPDATE blocks on A's row lock.
3. After A commits, B's UPDATE re-checks `WHERE id=` and writes `base_url = A`.
4. Result: key K2, which was meant for host B, is now sent to host A.

This needs two admins (or scripted API calls) racing each other. The UI only sends `base_url` when it changed, so it is unlikely.

**Fix:** `.for("update")` on the provider SELECT in PATCH, or a guard in the UPDATE itself:
`where(and(eq(id), body.api_key ? sql`true` : eq(aiProviders.baseUrl, cur.baseUrl)))`, returning 409 when no row matches.

### L2. `BODY_CAP` does not actually cap memory, and 3xx bodies are never consumed
`apps/api/src/ai/probe.ts:13,28`

`(await res.text()).slice(0, BODY_CAP)` reads the whole body first and truncates afterwards. A hostile or misbehaving
`openai_compatible` endpoint (admin-entered; SSRF and hostile hosts were accepted under T5) can stream hundreds of MB within the
10s window. That causes a memory spike in the API process. A body over V8's string limit throws, which is then caught and
reported as `network`. Separately, 3xx responses are never read or cancelled, so the socket stays open until GC.

The likelihood is low, but the constant reads like a safety guarantee that does not exist.

**Fix:** read `res.body` with a reader until `BODY_CAP` bytes, then `reader.cancel()`. Call `res.body?.cancel()` on 3xx.

### L3. `POST /providers/:id/models` racing `DELETE /providers/:id` returns a 500
`admin-providers.ts:183-204`

Only `23505` is mapped. If the delete commits first, the insert fails with an FK `23503` that is not mapped. `onError` then logs
a `DrizzleQueryError` and returns 500.

**Fix:** map `pgError(err, "23503")` to `404 not_found`.

### L4. "Key never in logs" is enforced only by reading the code
**No test checks it.** The success criterion is ticked, but no test spies on `console.*`. I found no plaintext path:
- the probe swallows fetch errors;
- the boot check logs only provider ids;
- secrets errors carry only a code.

**Ciphertext can still reach logs.** Any unexpected DB failure on insert or update of `ai_providers` reaches
`app.onError → console.error(err)`. Drizzle errors include the query params, so `api_key_enc` (ciphertext) and `key_last4` would
end up in API logs. That is not the plaintext key, but the ciphertext plus `SECRETS_KEY` on the same host recovers it.

**Fix:** optionally map or redact errors from the provider routes, and add one test that spies on `console.error` and
`console.info` during create, patch and probe.

### L5. Slot copy promises behaviour that does not exist yet
`tasks-section.tsx:101-104`

The copy says "Có hiệu lực từ job tạo sau khi lưu", but nothing reads the slots until phase 4. The plan ships everything as one
release, so this is acceptable as long as phase 2 is never deployed on its own. The implementer raised this too. If it might be
deployed alone, hide or soften the line.

### L6. Smaller UI issues
- The web form accepts prices above `100_000` (`parsePrice`). The API rejects them with `invalid_body`, and
  `providerError` → `errorMessage` then shows a generic error instead of the field message.
- The "Kiểm tra" result (`test.data`) stays on screen after the key is edited.
- `fail` / `invalid` and `SLOT_LABEL` are each defined twice (admin-providers vs admin-settings; api.ts vs tasks-section).

## Requested checks

### (a) Phase-2 success criteria
- **CRUD, FK integrity, and delete blocked by a slot or an active job:** met. Covered by API tests and confirmed in the
  migration run.
- **`base_url` change needs a new key; `model_id` cannot change:** met. 409 `key_required`; `AiModelPatch` is strict and
  rejects `model_id` with 400. One race remains (L1).
- **No key in any response:** met. Tests assert the plaintext, plaintext minus last4, and the ciphertext.
- **No key in any log:** met by code review only (L4).
- **Probe classification table, no redirects, 10s timeout:** met. The OpenAI and compatible live probes are unverified because
  no key was available (implementer concern, still open).
- **Docs:** met. Backup rule and "đổi `SECRETS_KEY` = nhập lại key" are in deployment-guide §2 and §7, and in job-queue-worker.

### (b) Security
- **Encryption format** (T4): correct.
- **Keys in zod errors:** none (verified, see runtime check 3).
- **`base_url`:** https only and normalised, no user/password; a change requires a key; a non-compatible provider with
  `base_url` returns 400.
- **Probe:** `manual` redirect, 10s timeout, no retry, no provider body returned.
- **Admin guard:** in place.
- **`SECRETS_KEY` env:** regex plus a 32-byte check, optional. A missing key returns 409 `secrets_key_missing` on create,
  key change and probe.

### (c) Data integrity
- **Migration and down file:** correct and reversible (verified). FK `RESTRICT` is on all 3 slots; `ai_models` cascades from
  `ai_providers`.
- **Active-job check:** the `jsonb_each` query guards with `jsonb_typeof` and matches the phase-4 `payload.llm` shape
  (`{slot: {provider_id, model}}`).
- **Locking:** a `FOR UPDATE` lock on the settings row serialises PUT slots, DELETE and PATCH vision.
- **Remaining races:** L1 and L3 only.

### (d) Phase 1 regressions
None found.
- `GET /settings` only gains `slots`, and the web `AdminSettings` type was updated.
- `lockSystemSettings` may insert the singleton row, but `pipeline` defaults to `{}` NOT NULL and the other columns are null,
  which the readers already treat as "use the default or env". No phase-1 reader changed.
- `tenant-isolation` still deliberately skips `/api/admin/`, and the `admin-access` sweep covers the new routes.
- Pipeline and fonts e2e pass according to the implementer; I did not rerun e2e.

### (e) Patterns and copy
- Code follows the repo patterns: `parseJson`, `inJobTx`, `HTTPException` with a `res`, `inList` CHECKs, generated migration
  plus a down file in the 0021 style, and kebab-case files.
- UI copy is Vietnamese with full diacritics. "Vision" and "Reasoning" stay in English as technical labels, which is acceptable.
- CSS adds no hard-coded colours.

### (f) Gate
Green; counts as listed in runtime check 1.

### My view on each implementer deviation
- **Pipeline listed first:** fine.
- **One save button doing sequential saves:** acceptable as a design, but the retry bug is real (M1).
- **Quick-add price-suggestion buttons:** fine. This is in scope under T18; reasoning suggestions turn the flag on and show the
  warning.
- **`secrets_configured` in the GET response:** fine. It is a boolean and does not leak anything.
- **400 `model_not_found` / `model_not_vision` and 409 `in_use` with `slot`:** fine, and consistent with the spec.
- **Same `base_url` needs no key; `base_url` on a non-compatible provider returns 400:** fine, and safe.
- **409 `key_unreadable`; empty model patch is a no-op:** fine.
- **Boot check does not block startup:** this is what the spec asks for.
- **No db migration test:** the plan did not require one. I covered the up/down/up run empirically. Adding it as a db test
  would be cheap.

## Recommended Actions
1. Fix M1: rebuild the draft after a partial failure, or make adds idempotent and run removes first. Add a unit test.
2. L1: lock the provider row in PATCH, or add a conditional UPDATE guard.
3. L2: read the probe body with a real byte cap and cancel 3xx bodies.
4. L3: map `23503` on add-model to 404.
5. Optional: add a `console.*` spy test for key leaks, and a db test for the 0022 up/down/up run.

## Metrics
- Type coverage: strict TypeScript, no `any` in the changed code (`as never` appears only in test fixtures).
- Tests: shared 56 / db 7 / api 361 / web 350, all passing.
- Lint issues: 0.

## Unresolved Questions
- Is phase 2 ever deployed on its own, before phase 4? If yes, L5 should be fixed.
- The OpenAI and openai_compatible live probes are still unverified with a real key (manual smoke test from the plan).

Score: **8.5/10**

Status: DONE
Summary: Phase 2 matches the spec. Encryption, the `base_url` → key rule, FK slots, the probe and the admin guard are all
correct; the gate is green with the expected counts; migration 0022 up/down/up checked out on a throwaway DB. One Medium
web-edit retry bug and a few Low issues (PATCH race, probe body cap, unmapped FK error on add-model).
Critical: 0 · High: 0
