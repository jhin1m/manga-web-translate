# Code review: local OCR default, proofread estimate, DeepSeek preset

Date: 2026-11-04 · Plan: `plans/261104-1731-local-ocr-proofread-warning-deepseek/plan.md` · Scope: uncommitted diff on `main`
(29 files, +461/−59) + untracked `apps/api/src/billing/proofread-estimate.ts`, `apps/api/test/proofread-estimate.test.ts`.

Re-ran focused: shared pipeline-settings (6), web proofread-model + provider-form-model (27), api proofread-estimate (2) — green.
External facts checked: api-docs.deepseek.com pricing, thinking-mode and vision guides (fetched 2026-11-04).

## Overall

Part 1 (input_rev baseline) is correct for its stated goal: `PREPARE_REV_BASELINE` equals the old `DEFAULT_PIPELINE_SETTINGS`
field-for-field, so pre-existing page/job revs are unchanged, and any local-OCR options always serialize into the rev
(cannot collide with an LLM rev). LLM classification (`llmJobSql`, `isLlmPayload`, `prepareUsesLlm`) needs no change and
stays consistent. Part 2 is SQL-correct and tenant-safe. Part 3 has one real runtime gap (DeepSeek thinking mode) that the
"no worker change" decision cannot cover. Score **7/10**.

## Critical

None.

## High

### H1. DeepSeek preset runs with thinking ON (effort high) — worker never disables it; preset says `reasoning: false`
- `apps/web/src/features/admin/price-suggestions.ts:29-30`, `worker/mtl_pipeline/providers/openai.py:115-134`
- DeepSeek docs (thinking_mode guide): "Thinking mode is enabled by default, with the default effort being `high`";
  disable via `extra_body={"thinking": {"type": "disabled"}}`. The pricing page confirms both `deepseek-flash` and `deepseek-v4-pro`
  "support both non-thinking and thinking (default) modes".
- `OpenAIProvider._kwargs` sends only `model/response_format/messages/max_tokens`; `reasoning_effort` is gated on
  `self.official`. No `thinking` param is ever sent for compatible endpoints. Anthropic (`thinking: disabled`) and Gemini
  (`thinking_budget`/`MINIMAL`) providers both explicitly suppress thinking. OpenAI-compatible does not.
- Failure scenario: admin picks the DeepSeek preset, clicks `+ deepseek-flash` (vision ✓, reasoning ✗ → no
  `REASONING_WARNING`), assigns it to Translate/Proofread/OCR. Each call reasons at high effort inside `max_tokens`
  2048/3072/4096. The output then either ends with `finish_reason=length`, which raises a `schema` error, or trips
  `guard_output_tokens` (proofread guard 3328). Jobs fail after being billed, or cost several times the estimate. "Kiểm
  tra" only GETs `/models`, so it passes and hides this.
- This contradicts the module's own rule (`price-suggestions.ts:4`: "Mặc định gợi ý model KHÔNG reasoning … model
  reasoning có cờ + cảnh báo") and the plan claim "lưu & kiểm tra như compatible".
- Fix options (needs user call, because the plan locked "không đổi protocol worker"):
  a. Worker-only change, no payload/protocol change and no MIN bump. In `OpenAIProvider`, when the base_url host is
     `api.deepseek.com`, add `extra_body={"thinking": {"type": "disabled"}}`. Add a pytest that asserts the kwargs. Ship with
     a worker deploy.
  b. Without a worker change, set `reasoning: true` on both DeepSeek suggestions so the warning shows. Document that
     DeepSeek runs with thinking on. This is honest, but the preset becomes a trap.
  c. Hold the preset until (a) lands.
- Separately unverified: whether `response_format: json_object` is honored in thinking mode. The docs are silent. Option (a)
  avoids the question.

## Medium

### M1. "Chạy lại trang lỗi" now re-runs stage 1 (local OCR) for every pre-existing translate-failed page
- `apps/api/src/jobs/translate-chain.ts:313-317`
- `stage1 = failed.filter(p => !p.ocrResult || p.prepareInputRev !== prepareKey(..., options).inputRev)`. Old pages carry
  the baseline rev, and `options` is now local OCR (not baseline), so the revs differ. Every `partial_failed` page from
  before the deploy that failed in **translate** is re-prepared: detect + inpaint + local OCR, with GPU time on Modal. It
  is not just re-translated.
- Consequences:
  - Retry takes minutes instead of seconds.
  - The chapter ends up with mixed OCR engines (LLM for good pages, Paddle/MangaOCR for retried ones).
  - Source text of those pages changes.
- "Trang cũ không đổi input_rev" is literally true, but this is the only staleness comparison in the codebase, and the
  default flip trips it. It is semantically defensible ("settings changed → stale"), but it is undocumented and untested.
- Options: accept and document it in `docs/job-queue-worker.md` (retry-failed re-OCRs old pages with the current engine).
  Or compare against the stored payload of the page's last prepare job / treat baseline-rev pages as fresh when they have
  `ocrResult`. Either way, add an API test: page with a baseline rev + `ocrResult` + `failed`, run retry-failed, and
  assert the chosen behavior.

### M2. Confirm box drops the data-sending disclosure while loading or on error
- `apps/web/src/features/chapter/proofread-panel.tsx:173-188`
- The line "Gửi lên nhà cung cấp AI: ảnh từng trang…" is produced only by `estimateLines(estimate.data)`. In the
  `isPending` branch ("Đang ước tính…") and the `isError` branch ("Vẫn có thể chạy"), the confirm button is enabled
  (`disabled` ignores `isPending`), so a user can run without ever seeing that images are uploaded. That violates plan
  decision 2 ("ghi rõ gửi ảnh…") whenever the estimate is slow or fails.
- Fix: render the static privacy line outside the estimate branches, and/or disable confirm while `estimate.isPending`.
  Keep it enabled on error (the current intent), but show the disclosure.

### M3. Deploy/rollout gap: local-OCR models are now on the default path but still `optional`
- `worker/models.lock.json` (manga_ocr_*, paddle_* `optional: true`), `worker/mtl_pipeline/models.py:3-4` ("chỉ dùng
  khi cài đặt pipeline của người dùng chọn"), `docs/deployment-guide.md:116-120` (`--required` để bỏ qua)
- Failure scenario: the Modal volume was populated with `fetch_models.py --required`, or before the OCR models existed.
  After this deploy, every cold Modal container lazily downloads MangaOCR (~460MB) or Paddle mid-job for the first ja/ko
  page. That adds latency and GPU-billed idle time, and there is no checklist step forcing a volume refresh. The docstring
  and the guide's `--required` advice are now stale.
- Fix: add a release checklist entry (verify that `modal volume ls mtl-models` contains the OCR files before shipping the API
  change) and update the `optional` wording. Flipping `optional` to false is a separate choice, since it makes worker
  startup fail without the models.

## Low

- **L1. `gcTime: 0` is ineffective while the panel stays mounted.**
  `proofread-panel.tsx:87-94`: the observer persists with `enabled: false`, so the cache is kept. On reopen the stale
  estimate (old page count/price) renders with no "Đang ước tính…" until the refetch lands, and confirm is clickable in
  that window. Use `confirming ? useQuery… : null` via a child component, or `queryClient.removeQueries` on close, or
  gate on `isFetching`.
- **L2. A11y focus loss.**
  Clicking the trigger sets `confirming` and disables the focused button (`:150`), so focus falls to `<body>`. The new
  region is not announced. Move focus to the confirm button or region (`ref.focus()`), and consider Esc to cancel.
- **L3. History mixes models and attempts.**
  `proofread-estimate.ts:84-120`: ledger tokens are summed across all attempts (failed attempts inflate per-page tokens),
  but seconds use only the last attempt. History also ignores which model ran, so after switching the slot (e.g. Gemini
  Pro → DeepSeek) the time and token estimates reflect the old model. This is acceptable for a "khoảng", but worth one
  comment.
- **L4. `price_known: false` uses the max static price ($3/$15).**
  `proofread-estimate.ts:130`. The env default Standard tier is far cheaper, so the estimate overstates by ~5–10× when no
  slot is set. It is labeled, so this is only a UX nit.
- **L5. History query scans the user's whole job history.**
  `jobs_user_idx (user_id, created_at)` plus filters on type/status. A user with many `page.prepare` jobs and few
  proofreads scans all of them on every confirm open. This is fine at MVP scale. If it shows up, add a partial index on
  `(user_id, created_at) where type='chapter.proofread' and status='succeeded'`.
- **L6. `pageCount` differs slightly from `enqueueProofread`.**
  It lacks the `innerJoin(pageStates)` and the `PROOFREAD_STATUSES` chapter check. This is harmless today (every page gets
  `page_states` at ingest, and the UI gates on status), but the count can drift if either changes. Consider extracting a
  shared `proofreadPagesWhere`.
- **L7. `isDefaultPrepareOptions` no longer means "default".**
  The exported name is unchanged while its semantics are now "baseline" (`pipeline-settings.ts:161`). The comments in
  `job.ts:287` ("khác mặc định") and `idempotency.ts:26-28` are stale. Rename it to `isBaselinePrepareOptions` (only one
  consumer).
- **L8. The "fixed" baseline is not fully fixed.**
  `PREPARE_REV_BASELINE` reads `DETECTION_THRESHOLD.default` and `INPAINT_SIZE.default`. Changing either UI default would
  silently shift every page's rev. Use literals `0.35` / `512`.
- **L9. `applyChoice` edge cases.**
  - Switching compatible (custom URL typed) → DeepSeek → compatible loses the typed URL.
  - Switching DeepSeek → OpenAI keeps DeepSeek model rows and prices.
  - A manually typed name "DeepSeek" is cleared on leaving.

  These are minor, and the saved-provider case is correct (select disabled, `choiceOf` shows "DeepSeek", `toPatchBody`
  unaffected).
- **L10. Contract duplication.**
  `ProofreadEstimate` is declared separately in api (`proofread-estimate.ts:24`) and web (`proofread-model.ts:64`). Other
  API↔web shapes go through `@mtl/shared`, so drift is not type-checked.
- **L11. Kill-switch semantics widened.**
  With the local default, `GLOBAL_DAILY_USD=0` ("chặn mọi job tốn tiền") no longer pauses `page.prepare`. The dispatcher
  stops new Modal containers (`dispatcher.ts:149`), but warm containers keep claiming GPU-billed prepares until scaledown.
  This was a pre-existing design for local OCR, and it now applies to the default path. Note it in the env doc.

## Verified OK (risk calibration)

- **input_rev.** For an LLM-only config the rev equals the legacy rev (shared + api tests). A local config always mixes
  options in, so there is no cross-engine collision. Idempotency keys follow the revs. Old queued jobs are untouched.
- **LLM classification.** `llmJobSql` and `isLlmPayload` key on `payload.pipeline.ocr_engine`, and `coalesce(...,'llm')`
  keeps legacy payloads LLM. `prepareUsesLlm` (commit quota at `chapters.ts:306`) now correctly skips quota for
  default-local prepared-only commits.
- **`useLlmOcr()`.** This is a legitimate fixture. Those files (budget, quota, breaker, error-classes, admin-limits)
  test LLM-gating semantics, which need an LLM prepare. `isolate-queue.ts` `beforeAll` deletes `system_settings` per file
  (and `fileParallelism: false`), so there is no cross-file leakage. Local-path coverage still exists
  (`pipeline-settings.test.ts` breaker case, `claim-llm.test.ts:149/174`, `translate-chain.test.ts:118`).
- **Missing test.** No test covers a commit with `target=prepared` + an over-quota user + default local OCR passing
  quota (`prepareUsesLlm` false).
- **Estimate SQL.**
  - Page count filters match enqueue (`skipped=false`, `status='ready'`, user + chapter).
  - History is scoped to `user_id`, `chapter.proofread`, `succeeded`, and `claimed_at` not null.
  - Ledger kinds `llm_tokens_in` / `llm_tokens_out` are summed over owned job ids; the index leads with `job_id` via the
    unique key.
  - Duration is `updated_at - claimed_at`. `updated_at` is bumped by drizzle `$onUpdate` on the `succeeded` update, and
    nothing touches succeeded proofread jobs afterwards.
- **Tenant isolation.** `sdb.byId` gives a 404 cross-tenant (test added and route added to `tenant-isolation`). Only the
  admin-chosen provider label and model id are exposed; no key or base_url.
- **`inJobTx` on a GET.** This matches the existing pattern (e.g. `admin-users.ts:28`). There are no row locks, so it is a
  harmless extra BEGIN/COMMIT.
- **DeepSeek facts.** Prices match the pricing page exactly: flash $0.30/$1.20 peak with vision ✓, v4-pro $1.32/$3.96 with
  vision ✗. The admin slot API rejects non-vision models for OCR/Proofread (`admin-settings.ts:128`). The openai SDK with
  base `https://api.deepseek.com` posts to `/chat/completions`, which DeepSeek serves. Base64 `image_url` data URLs are a
  supported vision input. The probe uses `GET /models` (supported).
- **Docs.** The README and `docs/job-queue-worker.md` claims match the code (baseline, estimate basis, ≤20 runs, preset
  stored as compatible). The only stale docs are those listed in M3 and L7.

## Recommended actions (priority)

1. H1: decide between options a/b/c with the user. Recommended: (a), a worker-only `thinking: disabled` for the DeepSeek host,
   plus a pytest.
2. M2: always show the image-upload disclosure, and disable confirm while the estimate is pending.
3. M1: decide on retry-failed semantics for legacy-rev pages, then add a test and/or a doc line.
4. M3: add a Modal volume model check to the release checklist, and fix the `optional` docstring and guide wording.
5. Low items as convenient. L8 and L7 are one-line hardening steps for the rev invariant.

## Plan status

Phases 1–3 are implemented. Phase 4: the gates are reported green. H1 blocks the acceptance criterion "lưu & kiểm tra
như compatible" in practice, and M2 partially blocks "thấy cảnh báo … phải bấm xác nhận". Leave plan status mutation to
the lead.

## Unresolved questions

- Does DeepSeek honor `response_format: json_object` in thinking mode, and does `usage.completion_tokens` include the
  reasoning tokens? The docs are silent. This needs one live call with a key.
- Is the production Modal volume already holding the MangaOCR/Paddle files?
- Intended product behavior for M1: should retry-failed re-OCR old translate-failed pages with the new local engine?

Status: DONE_WITH_CONCERNS
Summary: Rev-baseline, LLM gating and the estimate API are correct and tenant-safe. The DeepSeek preset will run with thinking on (no worker suppression), and the confirm box can hide the image-upload disclosure.
