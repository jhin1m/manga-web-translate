---
phase: 4
title: "Key theo job qua claim + breaker theo provider + billing + bỏ tier + 0.10.0"
status: completed-pending-smoke
priority: P1
effort: "2d"
dependencies: [2, 3]
---

<!-- red-team -->
# Phase 4: Key theo job qua claim + breaker theo provider + billing + bỏ tier + 0.10.0

## Overview

Đổi hợp đồng API ↔ worker (pipeline **0.10.0**, T14): enqueue snapshot slot `{provider_id, model}` vào payload, claim giải
mã key và đính `llm` theo slot (T10), worker dựng provider theo cấu hình job (cache) bằng `OpenAIProvider`/Anthropic/Gemini
đã có (phase 3). Breaker LLM tách theo provider (T11). Billing sửa 1 lần (T12). Bỏ tier Standard/Premium (D5, T13) với
tương thích ngược 1 phiên bản, gỡ `series.llm_tier` (migration **0023 `drop_series_llm_tier`**). Không slot → env như cũ.

## Requirements

- Functional:
  - Slot theo loại job: `page.prepare` OCR LLM → `ocr` (OCR local → không slot); `chapter.translate` → `translate`;
    `page.ocr_region` → `ocr` (engine `llm`) + `translate`; `chapter.proofread` → `proofread`. Slot chưa gán → slot đó
    không có trong `llm` → worker dùng env cho slot đó.
  - Đổi key trên UI → job claim sau dùng key mới, không restart worker.
  - <!-- red-team --> Claim không giải mã được key (thiếu/sai `SECRETS_KEY`) hoặc không thấy ref → job `failed` lớp **`auth`**,
    `error` = "Cấu hình AI lỗi: <không giải mã được key | provider/model không còn> của provider «tên» — admin nhập lại
    key ở Cài đặt › AI", không retry, chương không kẹt. (Ref mất gần như không xảy ra: phase 2 chặn xoá khi còn job active.)
  - Key không bao giờ ghi vào `jobs.payload/result/error`, events, log; claim response `Cache-Control: no-store`.
  - <!-- red-team --> Breaker: ≥5 lỗi `provider|rate_limited` trong 5' của **một** provider chỉ dừng job dùng provider đó;
    job không có `payload.llm` dùng khoá `env` (= hàng `llm_errors`/`llm_paused` hiện có).
  - <!-- red-team --> Billing: job có `payload.llm` → giá của ref khớp `usage.model` theo `(provider_id, model)`
    (`page.ocr_region` 2 ref khác model → max từng chiều); không có `payload.llm` → `llmPrice()` bảng tĩnh y nguyên.
  - <!-- red-team --> Proofread: chưa gán slot Hiệu đính → payload vẫn `model_tier` + key `{tier}` **y như cũ** (tier đọc từ
    `proofread_tier` còn lưu trong `system_settings.pipeline` jsonb, mặc định `standard`) → job cũ/mới dedup được, owner
    đang dùng premium không bị hạ âm thầm; có slot → `llm.proofread` + key `{llm}`, không `model_tier`. Bỏ ở bản sau.
  - <!-- red-team --> Gỡ `series.llm_tier` khỏi UI/API/DB; xoá không tăng `settings_rev` (bản dịch cũ không bị coi lỗi thời).
- Non-functional: worker 0.10.0 đọc được payload/claim cũ (trường mới optional) → deploy worker trước an toàn.

## Architecture

### Hợp đồng (packages/shared)
- `job.ts`: `LlmRef = z.object({ provider_id: z.uuid(), model: z.string().min(1).max(128) })`,
  `LlmRefs = z.object({ ocr, translate, proofread: LlmRef.optional() })`; `llm: LlmRefs.optional()` vào payload
  `page.prepare`, `chapter.translate`, `page.ocr_region`, `chapter.proofread` (`job.ts:136-205`).
  `chapter.proofread.model_tier` (`:201`) → `.optional()` (comment: bỏ ở bản sau 0.10.0).
- `worker-protocol.ts`: <!-- red-team --> `LlmConfig = { type: enum(AI_PROVIDER_TYPES), model, api_key: z.string().min(1),
  base_url: z.url().nullable(), structured_output: enum(STRUCTURED_OUTPUTS), reasoning: z.boolean() }` (chỉ trường worker
  dùng — bỏ `vision`); `ClaimedJob` (`:182`) thêm `llm: z.object({ ocr, translate, proofread: LlmConfig.optional() }).optional()`.
  `JobFonts` **không đổi** (font hệ thống dùng `custom-*`, phase 7).
- `pipeline-settings.ts`: bỏ `proofread_tier` khỏi `PipelineSettingsFields` (`:50`) + `DEFAULT_PIPELINE_SETTINGS` (`:73`);
  giữ `PROOFREAD_TIERS` + thêm `legacyProofreadTier(raw: unknown): ProofreadTier` (đọc key cũ trong jsonb, lạ → standard).
- `pnpm schema:emit` → commit `packages/shared/json-schema/*`.

Claim response mẫu (`api_key` thật trong response, ở đây che):
```json
{
  "jobs": [{
    "id": "0193f3a0-…", "type": "page.ocr_region", "attempt": 1,
    "lease_token": "9c1e…", "lease_expires_at": "2026-11-05T03:00:00.000Z",
    "payload": {
      "type": "page.ocr_region", "page_id": "0193…", "bbox": [10, 20, 200, 80],
      "source_lang": "ko", "target_lang": "vi", "ocr_engine": "llm", "reading_order": "ltr",
      "llm": {
        "ocr": { "provider_id": "0193aa…", "model": "gemini-2.5-flash" },
        "translate": { "provider_id": "0193bb…", "model": "gpt-4.1-mini" }
      }
    },
    "inputs": { "original": "https://files…", "context_lines": [] },
    "outputs": {},
    "llm": {
      "ocr": { "type": "gemini", "model": "gemini-2.5-flash", "api_key": "[redacted]", "base_url": null,
               "structured_output": "json_schema", "reasoning": false },
      "translate": { "type": "openai", "model": "gpt-4.1-mini", "api_key": "[redacted]", "base_url": null,
                     "structured_output": "json_schema", "reasoning": false }
    }
  }]
}
```
`payload.llm` (lưu DB, không key) = snapshot lúc enqueue; `llm` cấp job (chỉ trong response claim) = cấu hình giải mã lúc
claim. Job không slot → không có cả hai.

### API
- `apps/api/src/ai/llm-refs.ts`: `slotRefs(t, slots)` đọc 3 cột slot `system_settings` (`FOR SHARE`, tuần tự với
  DELETE/PUT slot phase 2) ⨝ `ai_models` ⨝ `ai_providers` → `LlmRefs` chỉ gồm slot đã gán; rỗng → `undefined`.
- `apps/api/src/jobs/enqueue.ts`: gắn `llm` (khi có) ở `enqueuePrepare` (`:241`, chỉ khi `options.ocr_engine === "llm"`),
  `enqueueTranslate` (`:285`), `enqueueOcrRegion` (`:355`, `ocr` chỉ khi engine `llm`), `enqueueProofread` (`:428`;
  `:441-452` theo quy tắc proofread ở Requirements). `createIngestedPages` (`:493`) đọc refs 1 lần cho cả vòng lặp.
- `apps/api/src/jobs/idempotency.ts`: `llm` vào **options** của `idempotencyKey` (không vào input_rev của prepare/translate →
  `retryFailedPages` `translate-chain.ts:315` không coi page cũ là lỗi thời khi đổi model) và chỉ khi có. `prepareKey(:20)`
  + `translateKey(:30)` thêm `llm?` (không có → `{}` = key cũ). <!-- red-team --> `proofreadKey(:52)` nhận `{ tier } | { llm }`:
  không slot → `{ tier }` y như cũ. `pageOpKey(:42)` tự gồm `llm` qua `opts`.
- `apps/api/src/ai/llm-config.ts`: `resolveLlmConfigs(t, refs)` → `ai_providers ⨝ ai_models` theo `(provider_id, model)`;
  lỗi → `throw new LlmConfigError(<câu ở Requirements>)` (không nhúng blob/key).
- `apps/api/src/jobs/queue.ts`: `ClaimedJobOut` (`:67`) thêm `llm?`; trong `try` của claim (`:166-176`) sau `buildInputs` gọi
  `resolveLlmConfigs`; <!-- red-team --> `catch`: `err instanceof LlmConfigError` → `terminal(t, job, "failed", "auth", msg)`,
  còn lại giữ `invalid_input`. `llm` chỉ nằm trong object trả về, **không** ghi DB.
- `apps/api/src/routes/worker.ts:47`: `c.header("Cache-Control", "no-store")` cho claim.
- <!-- red-team --> **Breaker** `apps/api/src/jobs/breaker.ts`: khoá theo provider — `errorsKey(k) = k === "env" ?
  "llm_errors" : \`llm_errors:${k}\``, tương tự `llm_paused`; `breakerKeysOf(payload)` = các `provider_id` khác nhau trong
  `payload.llm`, rỗng → `["env"]`; `recordProviderError(tx, key, now)`; `pausedBreakerKeys(tx, now): string[]` (đọc mọi
  hàng `llm_paused%` còn hạn). `breakerBlockedSql(paused)` = `llmJobSql and ((payload->'llm' is null and 'env' = any(paused))
  or exists (select 1 from jsonb_each(payload->'llm') e where e.value->>'provider_id' = any(paused)))`. Caller:
  `queue.ts:89,112` (claim; tách biến breaker khỏi `blockLlm` của ngân sách `:91`), `queue.ts:684` (fail: ghi cho mọi khoá
  của job), `dispatcher.ts:154-156`. Job 1 slot DB + 1 slot env (ocr_region gán 1 slot) tính theo provider DB — chấp nhận.
- <!-- red-team --> **Billing** `apps/api/src/billing/prices.ts`: `llmPriceFor(t, model, payload)`; `ledger.ts:70` gọi
  `await llmPriceFor(tx, usage.model, job.payload)`. `MAX_OUTPUT_TOKENS_PER_CALL` giữ.
- <!-- red-team --> **Bỏ `series.llm_tier`**: `apps/api/src/routes/series.ts:28` (`LLM_TIERS`), `:50` (zod — body cũ có
  `llm_tier` bị strip, không 400), `:86` (view), `:232` (set), `:247` (`translationChanged`), `:308` (insert);
  `packages/db/src/schema/app.ts:78` bỏ cột → `pnpm --filter @mtl/db generate --name drop_series_llm_tier` (`ALTER TABLE
  "series" DROP COLUMN "llm_tier"`) + down (`ADD COLUMN "llm_tier" text DEFAULT 'default' NOT NULL`). Không đụng
  `settings_rev`.
- `apps/api/src/env.ts:43` `MIN_PIPELINE_VERSION` mặc định `0.10.0` + comment "0.10.0: payload `llm` + claim `llm` (key
  theo job), `model_tier` optional". `PIPELINE_VERSION` (muối input_rev) giữ 0.4.0.

### Worker
- <!-- red-team --> `worker/mtl_worker/llm_cache.py`: `provider_for_config(cfg)` — cache `OrderedDict` cấp module tối đa 8 theo
  `(type, model, base_url, structured_output, reasoning, sha256(api_key)[:16])`, bị đẩy ra → `close()` client nếu có;
  dựng bằng `provider_from_config(cfg)` (`providers/__init__.py`): `anthropic` → `AnthropicProvider(model,
  client=anthropic.Anthropic(api_key=…, max_retries=0))`, `gemini` → `GeminiProvider(model, client=genai.Client(api_key=…))`
  (2 class đã nhận `client=`), `openai`/`openai_compatible` → `OpenAIProvider(…, structured_output, reasoning)`.
- `worker/mtl_worker/handlers.py`: hàm tự do `llm_provider(ctx, deps, slot)` — `ctx.llm.get(slot)` có →
  `provider_for_config(cfg)`; không → `deps.provider` (proofread: `deps.provider_for(p.get("model_tier","standard"))`).
  **Không thêm method vào `Deps`** → fake deps hiện có không phải đổi chữ ký. Call site: `run_ocr` (`:81`, slot `ocr`),
  `handle_translate` (`:270`; `:279` `model` lấy từ provider của slot), `handle_ocr_region` (`:405` OCR, `:423` dịch),
  `handle_proofread` (`:452`).
- `worker/mtl_worker/runner.py`: `JobContext` (`:79`) `self.llm = job.get("llm") or {}`; đầu job `register_secret(api_key)`
  cho mọi cfg, cuối job `clear_secrets()` (`log_redact.py` phase 3).
- `worker/mtl_worker/main.py:51` `RuntimeDeps.provider` env lười: không có key env → `ProviderError("auth", "chưa cấu hình
  provider AI (slot DB hoặc env worker)")`; eager-load `:134` chỉ khi có key env của `--provider`.
- `worker/mtl_worker/__init__.py` `PIPELINE_VERSION = "0.10.0"` + dòng lịch sử.

### Web
- `apps/web/src/features/pipeline/pipeline-settings.tsx:17,38,190` bỏ select tier.
- `apps/web/src/features/series/series-settings-form.tsx:67,209-216` bỏ select "Model dịch"; `apps/web/src/features/series/api.ts:17`.
- `apps/web/src/features/chapter/job-error.ts:19-20` `AUTH_HINT` → "Khoá API AI sai, hết hạn mức hoặc chưa cấu hình —
  admin sửa ở Cài đặt › AI › Nhà cung cấp (hoặc key env của worker) rồi bấm "Chạy lại trang lỗi"."

### Data flow
Admin gán slot → enqueue: `slotRefs` → `payload.llm` → `jobs` → claim: breaker theo provider lọc → khoá job → `buildInputs`
→ `resolveLlmConfigs` (giải mã trong RAM) → response (TLS, `no-store`) → worker validate `claim-response` →
`register_secret` → cache provider → gọi LLM → usage `{model}` → heartbeat/complete → `llmPriceFor(model, payload)` → ledger.
Lỗi provider → `fail` (câu chung) → `recordProviderError(key provider)`.

## Related Code Files

- Create:
  - `apps/api/src/ai/llm-refs.ts`, `apps/api/src/ai/llm-config.ts`
  - `apps/api/test/claim-payload.test.ts` (Tests Before), `apps/api/test/claim-llm.test.ts`, `apps/api/test/prices.test.ts`
  - `packages/db/migrations/0023_drop_series_llm_tier.sql` (+ snapshot/journal), `packages/db/migrations-down/0023_drop_series_llm_tier.down.sql`
  - `worker/mtl_worker/llm_cache.py`, `worker/tests/test_provider_config.py`
- Modify:
  - `packages/shared/src/job.ts`, `worker-protocol.ts`, `pipeline-settings.ts`, `packages/shared/json-schema/*.schema.json`
    (emit), `packages/shared/test/shared-contracts.test.ts`, `packages/shared/test/pipeline-settings.test.ts`
  - `packages/db/src/schema/app.ts:78`
  - `apps/api/src/jobs/enqueue.ts`, `idempotency.ts`, `queue.ts`, `breaker.ts`, `dispatcher.ts`, `apps/api/src/routes/worker.ts`,
    `apps/api/src/routes/series.ts`, `apps/api/src/billing/prices.ts`, `ledger.ts`, `apps/api/src/env.ts`
  - `apps/api/test/proofread.test.ts:56`, `apps/api/test/pipeline-settings.test.ts`, `apps/api/test/error-classes.test.ts:60`
    (breaker theo khoá), `apps/api/test/chapters.test.ts:531-535` (bỏ `llm_tier`), `apps/api/test/dispatcher.test.ts`,
    `apps/api/test/worker-helpers.ts:17` (`VERSION = "0.10.0"`)
  - `apps/web/src/features/pipeline/pipeline-settings.tsx`, `apps/web/src/features/series/series-settings-form.tsx`,
    `apps/web/src/features/series/api.ts`, `apps/web/src/features/chapter/job-error.ts` + `job-error.test.ts`,
    `apps/web/e2e/fake-worker.ts:10` (`VERSION = "0.10.0"`), `apps/web/e2e/seed.ts:18` (bỏ `llmTier`)
  - `worker/mtl_pipeline/providers/__init__.py` (`provider_from_config`), `worker/mtl_worker/main.py`, `runner.py`,
    `handlers.py`, `__init__.py`
  - <!-- red-team --> Fake deps (chữ ký không đổi; thêm ca có `llm` cfg với factory giả qua monkeypatch
    `llm_cache.provider_from_config`): `worker/tests/test_worker_runner.py:172`, `worker/tests/test_proofread.py:170,210`,
    `worker/tests/test_translate_carry.py:34` (`_Deps`, dùng ở `:107,119,131,140,150,178,179,193,197`);
    `worker/tests/test_contract_schema.py`
  - `worker/modal_app.py:6-7` (comment: `GEMINI_API_KEY` chỉ còn là fallback)
  - `docs/job-queue-worker.md` (Giao thức worker `:100`, Phân loại lỗi `:127`, AI hiệu đính `:286`, mục mới "Provider AI từ
    DB (pipeline 0.10.0)", breaker theo provider), `docs/deployment-guide.md` (checklist 0.10.0, mục 5 Modal secret, rủi ro
    token worker)
- Delete: không.

## Implementation Steps

### Tests Before (xanh trên code phase 3)
1. `apps/api/test/claim-payload.test.ts`: khoá claim 4 loại job LLM khi chưa có provider DB — key object job đúng tập
   `{id,type,attempt,lease_token,lease_expires_at,payload,inputs,outputs}`; payload proofread có `model_tier` theo pipeline;
   `idempotency_key` của prepare/translate/**proofread `{tier}`** = công thức hiện tại → sau refactor job không slot ra
   **cùng key**.
2. `apps/api/test/prices.test.ts`: khoá `llmPrice` (model biết → giá bảng; `null`/lạ → max, `known:false`) + ledger
   `page.ocr_region` tính theo `usage.model`.
3. `apps/api/test/error-classes.test.ts:60` (breaker trips after 5) + `dispatcher.test.ts` xanh — khoá breaker toàn cục cho
   job env (khoá `env` giữ đúng tên hàng cũ).
4. `apps/api/test/chapters.test.ts:531`: khoá `settings_rev` sau tạo series; thêm ca PATCH series không đổi trường dịch →
   `settings_rev` giữ nguyên.
5. Worker: `uv run pytest` xanh (đặc biệt `test_translate_carry.py`, `test_proofread.py:160,205`).
6. Commit `test: lock claim payload, breaker and proofread key before per-job llm config`.

### Refactor / Implement
7. Shared contract + `pnpm schema:emit`.
8. API: `llm-refs.ts`, enqueue + idempotency (proofread legacy), `llm-config.ts` + `LlmConfigError`, claim + `no-store`,
   breaker theo provider, billing, `MIN_PIPELINE_VERSION`.
9. `series.llm_tier` gỡ: API + migration 0023 + down + web.
10. Worker: `provider_from_config`, `llm_cache.py`, `llm_provider` trong handlers, `JobContext.llm` + đăng ký secret,
    `RuntimeDeps.provider` lười, `PIPELINE_VERSION`.
11. Web bỏ select tier + `AUTH_HINT`; docs + checklist deploy.

### Tests After
12. Shared: payload có `llm` parse được; proofread cũ có/không `model_tier` đều parse; `ClaimResponse` có/không `llm`;
    `LlmConfig` thừa trường `vision` → từ chối (strict); json-schema đã emit khớp zod.
13. `claim-llm.test.ts` (provider tạo qua admin API, key `sk-test-…`):
    - slot Dịch gán → `payload.llm.translate = {provider_id, model}`; claim trả `llm.translate.api_key` = key gốc;
      `JSON.stringify(jobs row)` không chứa key; header `Cache-Control: no-store`.
    - đổi key giữa enqueue và claim → claim trả key mới.
    - đổi `SECRETS_KEY` (blob cũ không giải mã được) → job `failed`, `error_class = "auth"`, `error` có "Cấu hình AI lỗi",
      không chứa key/blob, chương không kẹt; claim kế vẫn trả job khác.
    - không slot → không có `llm` ở payload lẫn response; key = Tests Before.
    - OCR local → prepare không có `llm.ocr`; `ocr_region` engine llm → có `ocr` + `translate`.
    - đổi model slot rồi enqueue lại cùng input → idempotency key khác; input_rev prepare/translate không đổi.
    - proofread không slot + pipeline jsonb `proofread_tier: premium` → payload `model_tier: premium`, key `{tier:"premium"}`
      (dedup với job cũ); có slot → `llm.proofread`, không `model_tier`.
    - xoá provider khi còn job active tham chiếu → 409 `in_use_by_jobs` (bảo vệ phase 2 giờ có dữ liệu thật).
    - ledger: model khớp ref → giá ref; `ocr_region` 2 ref → max; job env → bảng tĩnh y Tests Before.
    - breaker: 5 lỗi job của provider A → job provider B và job env vẫn claim được; job A bị chặn 2'; 5 lỗi job env →
      chặn job env, không chặn job A.
    - worker `pipeline_version: "0.9.0"` → 426.
14. `series`: PATCH body cũ có `llm_tier` → 200, `settings_rev` không tăng; GET không còn `llm_tier`.
15. `worker/tests/test_provider_config.py`: `provider_from_config` đúng class + `api_key` tường minh; cache cùng cfg → cùng
    instance, đổi key → instance mới (cũ được `close()`); handler có cfg → dùng provider của slot (fake factory), không
    cfg → `deps.provider` (fake deps cũ không sửa vẫn chạy); proofread `model_tier: premium` không cfg → model premium env;
    không env key + không cfg → `auth`; key của job bị redact trong log và `fail.message`.
16. `test_contract_schema.py`: claim-response có `llm` hợp lệ; payload có `llm`.
17. e2e: `full-flow.spec.ts` / `proofread.spec.ts` / `series-manage.spec.ts` xanh với fake worker 0.10.0.

### Regression Gate
```bash
pnpm schema:emit && git diff --exit-code packages/shared/json-schema
pnpm --filter @mtl/db generate   # No schema changes
pnpm typecheck && pnpm lint && pnpm test
cd worker && uv sync && uv run pytest && uv run ruff check . && cd ..
pnpm --filter @mtl/web e2e full-flow proofread pipeline-settings series-manage
```
Smoke tay (key thật, ghi vào báo cáo cook): OpenAI `gpt-4.1-mini` qua slot Dịch dịch 1 chương; OpenRouter (compatible)
qua slot; Gemini qua slot OCR 1 trang; đổi key → job sau dùng key mới; log worker `-v` không chứa key.

### Checklist deploy (ghi vào `docs/deployment-guide.md`, "Checklist nâng cấp lên pipeline 0.10.0")
1. Backup DB; `.env` API có `SECRETS_KEY`, `ADMIN_EMAILS`; không ghi đè `MIN_PIPELINE_VERSION` < 0.10.0.
2. Worker Mac: `git pull && cd worker && uv sync`, restart launchd; Modal: `modal deploy modal_app.py`. Worker 0.10.0 đọc
   payload cũ (không `llm`, có `model_tier`) bình thường.
3. `infra/deploy.sh <ref>` (migrate 0021–0025, API + web + `mtl-jobs`).
4. Đảo thứ tự → API mới trả 426 cho worker cũ, hàng đợi dừng tới khi worker lên 0.10.0 (không mất job).
5. Rollback API về bản trước: **chạy down 0023 trước** (bản cũ đọc cột `series.llm_tier`); job có `payload.llm` → API cũ
   không đính `llm` → worker 0.10.0 dùng env (chạy được nếu env có key). Không hạ worker < 0.10.0 khi còn job có `llm`
   trong payload (schema cũ từ chối) — huỷ hoặc chờ chạy hết.
6. <!-- red-team --> Rủi ro còn lại ghi trong docs: token worker (Mac/Modal) bị lộ → kẻ giữ token claim được job và **lấy
   mọi key slot**, dùng key ngoài ledger (vượt mọi hạn mức). Biện pháp: bảo vệ token như secret cấp nền tảng, thu hồi ngay
   (`pnpm worker-token revoke`) + đổi key ở provider khi nghi lộ; bật giới hạn chi tiêu phía provider cho mọi key nhập vào.
7. Sau 1 phiên bản ổn định: bỏ `model_tier`/`proofread_tier` legacy (ngoài plan).

## Success Criteria

- [x] Job dùng đúng model/key của slot; không slot → env như cũ (cùng idempotency key với trước, cả proofread).
- [x] Đổi key có hiệu lực ở job claim kế tiếp, không restart worker.
- [x] Key không có trong DB jobs, response web, log API/worker (test assert).
- [x] Giải mã lỗi → `auth` + câu rõ ràng; breaker 1 provider không dừng provider khác.
- [x] Ledger: job slot tính theo giá ref; job env theo bảng tĩnh (không đổi).
- [x] `series.llm_tier` biến mất mà `settings_rev` không tăng; worker < 0.10.0 bị 426.

- [ ] Smoke tay key thật — chưa: OpenAI `gpt-4.1-mini` qua slot Dịch (1 chương); OpenRouter qua slot; Gemini qua slot OCR 1 trang;
  đổi key giữa chừng → job sau dùng key mới; quét log worker `-v` không có key. (Các tiêu chí trên được chứng minh bằng test + fake worker, chưa bằng key thật.)
- [x] Kiểm ảnh Modal có `openai`: cài từ pyproject (`modal_app.py:35`).

**Kết quả (2026-11-04)**: Tests Before 1–4, Implement 7–11, Tests After 12–17 xong (04a API/shared/web + 04b worker); review 8.5/10,
0 Critical/High; fix M1 (docs rollback), L1, L5, L6, L7 đã áp (L2–L4 chấp nhận). Lệch đáng nhớ: `saveSystemPipeline` merge jsonb
(giữ `proofread_tier` legacy khi admin lưu Pipeline); billing nhiều ref → max, một ref → giá ref nếu `usage.model` khớp, không thì bảng tĩnh;
lỗi thiếu provider dùng câu chung (không lộ uuid). Báo cáo:
`plans/reports/from-fullstack-developer-261104-1414-phase-04a-api-llm-config-report.md`,
`plans/reports/from-fullstack-developer-261104-1430-phase-04b-worker-llm-config-report.md`,
`plans/reports/from-code-reviewer-261104-1438-phase-04-review-report.md`.

## Risk Assessment

| Rủi ro | Khả năng × Tác động | Giảm thiểu |
|---|---|---|
| <!-- red-team --> Token worker bị lộ → lộ mọi key slot, chi tiêu ngoài ledger | Thấp × Cao | Rủi ro còn lại có chủ đích (key phải tới worker); docs: bảo vệ/thu hồi token, giới hạn chi tiêu phía provider; câu hỏi mở `worker_tokens.llm_keys` |
| Key trong RAM/mạng tới worker Modal | Chắc × TB | TLS mọi hop, `no-store`, không persist; redact log; chỉ key của slot job cần |
| Đổi hợp đồng: sai thứ tự deploy | TB × Cao | Worker trước (trường mới optional); 426 chặn worker cũ; checklist |
| Drop cột `series.llm_tier` làm rollback API vỡ | TB × TB | Checklist bước 5: down 0023 trước khi lùi API |
| `page.ocr_region` 2 model → giá gộp; breaker gộp | Chắc × Thấp | Max theo ref (bảo thủ); breaker ghi cho mọi provider của job |
| Hai job prepare cùng page khi đổi model giữa chừng | Thấp × Thấp | `requireRev` fencing ở complete |
| `SECRETS_KEY` sai → mọi job có slot fail `auth` | Thấp × Cao | Boot verify + alert (phase 2); gỡ slot → quay về env ngay; câu lỗi chỉ cách sửa |
| Cache provider giữ client của key cũ | Thấp × Thấp | Khoá cache có hash key; đẩy ra thì `close()` |

Rollback: xem checklist bước 5. Code worker và API revert độc lập được nhờ trường optional (trừ down 0023).
