---
phase: 2
title: "Provider/model/key (API + UI) + slot"
status: completed-pending-smoke
priority: P1
effort: "1.5d"
dependencies: [1]
---

# Phase 2: Provider/model/key (API + UI) + slot

## Overview

Bảng `ai_providers` (key mã hoá AES-256-GCM, D3) + `ai_models` (giá admin nhập, cờ vision/reasoning, D6), CRUD admin,
nút "Kiểm tra" chạy từ API (T5), 3 slot (D5) là 3 cột FK trên `system_settings`. **Chưa** đổi payload/claim/worker/
billing (phase 4) → không bump pipeline; job vẫn chạy bằng env.

## Requirements

- Functional:
  - Mục **AI › Nhà cung cấp**: list (tên, loại, `••••last4`, số model, Kiểm tra, sửa/xoá icon); form thêm: loại, tên,
    base URL (chỉ `openai_compatible`, bắt buộc `https://`), key, "Kiểu JSON" (chỉ compatible: `json_schema` mặc định —
    worker tự hạ `json_object` 1 lần khi endpoint từ chối; chọn `json_object` cho endpoint bỏ qua `response_format`),
    danh sách model (model id, giá in/out USD/1M **bắt buộc**, vision, reasoning). Sửa: đổi tên/kiểu JSON, **đổi key**
    (ô trống = giữ key cũ), thêm/xoá model, sửa giá/vision/reasoning.
  <!-- red-team -->
  - Đổi `base_url` mà không gửi key mới → 409 `key_required` (chống gửi key đã lưu tới host khác). `type` bất biến.
  - <!-- red-team --> `model_id` bất biến sau khi tạo (muốn đổi: xoá rồi thêm) — payload job tham chiếu theo chuỗi model.
  - Gợi ý giá (loại `openai`): mặc định model **không reasoning**; chọn gợi ý model reasoning → tự tick "reasoning" +
    cảnh báo "trần token ra (OCR 2048 / Dịch 4096 / Hiệu đính 3072) gồm cả token suy luận — dễ fail `schema`, tốn tiền
    không ra kết quả; nên dùng model không reasoning".
  - Mục **AI › Model tác vụ**: 3 select OCR / Dịch / Hiệu đính (`Tên provider · model`), OCR + Hiệu đính chỉ model
    `vision`; "Mặc định (env worker)" = `null`.
  <!-- red-team -->
  - Xoá provider/model → 409 khi (a) đang gán slot (`in_use`, kèm slot — FK `RESTRICT` báo) hoặc (b) còn job active
    (`queued|running|paused_budget`) có `payload.llm` tham chiếu provider_id (hoặc cặp provider_id + model) — `in_use_by_jobs`
    kèm số job. Đổi `vision = false` cho model đang gán OCR/Hiệu đính → 409.
  - `POST /api/admin/providers/:id/test {model?}` → `{ ok, reason: "ok"|"auth"|"not_found"|"quota"|"network"|"redirect"|"unknown",
    http_status, model_found? }`; không trả body provider thô.
  - API không bao giờ trả `api_key`/`api_key_enc` (chỉ `key_last4`). Thiếu `SECRETS_KEY` → tạo/đổi key 409
    `secrets_key_missing`.
- Non-functional: probe timeout 10s, không retry, không theo redirect.

## Architecture

**Hằng + schema dùng chung** — `packages/shared/src/ai-providers.ts` (export ở `index.ts`):
`AI_PROVIDER_TYPES = ["anthropic","gemini","openai","openai_compatible"]`, `STRUCTURED_OUTPUTS = ["json_schema",
"json_object"]`, `AI_TASK_SLOTS = ["ocr","translate","proofread"]`, `VISION_SLOTS = ["ocr","proofread"]`, zod
`AiModelInput {model_id 1..128, price_in ≥0, price_out ≥0, vision, reasoning}`, `AiModelPatch` (không có `model_id`),
`AiProviderInput` (refine: compatible ⇔ có `base_url`; `base_url` = URL `https:` không user/pass, bỏ `/` cuối/query/hash),
`ApiKey = z.string().trim().regex(/^[\x21-\x7e]{8,512}$/)` (ASCII in được, không khoảng trắng/zero-width giữa key),
`AiSlots {ocr|translate|proofread: uuid|null}`.

<!-- red-team -->
**DB** — `packages/db/src/schema/ai-providers.ts`, migration **0022 `ai_providers`**:
```
ai_providers: id uuid PK (v7, app sinh), type text CHECK inList(AI_PROVIDER_TYPES), name text not null,
  base_url text null CHECK ((type = 'openai_compatible') = (base_url is not null)),
  api_key_enc text not null, key_last4 text not null,
  structured_output text not null default 'json_schema' CHECK inList(STRUCTURED_OUTPUTS), created_at, updated_at
ai_models: id uuid PK, provider_id uuid FK → ai_providers ON DELETE CASCADE, model_id text not null,
  price_in numeric not null CHECK ≥0, price_out numeric not null CHECK ≥0, vision boolean not null default false,
  reasoning boolean not null default false, created_at; UNIQUE (provider_id, model_id)
system_settings + ocr_model_id / translate_model_id / proofread_model_id uuid null
  REFERENCES ai_models(id) ON DELETE RESTRICT
```
Xoá provider → cascade `ai_models` → RESTRICT từ slot chặn nếu model nào đang gán (lỗi PG `23503` → 409 `in_use`). Không
còn code kiểm tay toàn vẹn slot ngoài check vision.

<!-- red-team -->
**Secrets** — `apps/api/src/lib/secrets.ts`: 1 key, không keyring. Blob `base64(version:1B=0x01 | iv:12B | tag:16B |
ct)`, AAD `ai_provider:<providerId>`, `authTagLength: 16`. `encryptSecret(plain, providerId)`, `decryptSecret(blob,
providerId)` (version lạ → throw `unsupported_version`; byte version để mở đường xoay key sau). Key đọc từ
`env.SECRETS_KEY` **mỗi lần gọi** (không memo → test đổi/xoá env được; chi phí `Buffer.from` không đáng kể). Env
(`env.ts`): `SECRETS_KEY` (regex `^[A-Za-z0-9+/]{43}=$` + 32 byte, **optional**). Boot (`index.ts`):
`verifyProviderSecrets()` thử giải mã mọi provider; lỗi → `console.error` chỉ id + `sendAlert` (`lib/alert.ts`), không
chặn khởi động. Docs: đổi/mất `SECRETS_KEY` → mọi key không giải mã được → nhập lại key từng provider trên UI; restore
backup DB cần đúng `SECRETS_KEY` lúc backup.

<!-- red-team -->
**Probe** — `apps/api/src/ai/probe.ts` `probeProvider(p, key, model?, fetchFn = fetch)` (inject để test). Mọi request:
`fetchFn(url, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers })`; 3xx → `redirect`; timeout/lỗi
mạng → `network`; chỉ đọc JSON nhỏ để tìm `model_found`. Không kiểm DNS/IP (admin là người nhập; xem Risk).

| type | request | ok / lỗi |
|---|---|---|
| openai | `GET https://api.openai.com/v1/models` Bearer | 200 ok (+`model_found` theo `data[].id`); 401/403 auth |
| anthropic | `GET https://api.anthropic.com/v1/models?limit=1`, `x-api-key`, `anthropic-version: 2023-06-01` | 200 ok; 401/403 auth — **smoke test key thật** (docs mới ghi Bearer + `2026-10-21`) |
| gemini | `GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1`, `x-goog-api-key` | 200 ok; **400 body `API_KEY_INVALID`** / 401 / 403 → auth — **smoke test key thật** |
| compatible, host `openrouter.ai` | `GET {base}/key` (= `/api/v1/key`) Bearer | `/models` của OpenRouter công khai → không kiểm được key |
| compatible khác | `GET {base}/models` Bearer; 404/405/501 → `POST {base}/chat/completions {"model":m,"messages":[{"role":"user","content":"ping"}],"max_tokens":1}` | 200 ok; 401/403 auth; 404 not_found; 402/429 quota; 400 có `max_tokens` → ok |

**Routes** — `apps/api/src/routes/admin-providers.ts` (mount trong `adminApi()` phase 1):
`GET /providers` (kèm models) · `POST /providers` (id sinh trước để làm AAD; insert provider + models 1 transaction) ·
`PATCH /providers/:id` (đổi `base_url` thiếu `api_key` → 409 `key_required`) · `DELETE /providers/:id` ·
`POST /providers/:id/models` · `PATCH /models/:id` (`AiModelPatch`) · `DELETE /models/:id` · `POST /providers/:id/test`
· `PUT /settings/slots` (ở `admin-settings.ts`; kiểm vision cho VISION_SLOTS). `GET /settings` thêm `slots` (3 id).
DELETE + PUT slots chạy trong transaction có `SELECT … FROM system_settings FOR UPDATE` (tuần tự hoá với nhau và với
enqueue phase 4 đọc slot `FOR SHARE`). Kiểm job active:
`exists (select 1 from jobs where status in ACTIVE_JOB_STATUSES and exists (select 1 from jsonb_each(payload->'llm') e
where e.value->>'provider_id' = $id [and e.value->>'model' = $model]))` — phase này luôn rỗng (chưa có `payload.llm`),
có hiệu lực từ phase 4. Body qua `parseJson` (`lib/validate.ts:6`; issue zod 4 không mang input → key không rơi vào phản
hồi lỗi — có test). `key_last4 = key.slice(-4)`.

**Billing** — <!-- red-team --> **không đổi ở phase này** (sửa 1 lần ở phase 4).

**Web** — `apps/web/src/features/admin/`: `providers-section.tsx`, `provider-form.tsx`, `provider-form-model.ts`
(thuần: validate form, base URL https, gợi ý giá + cờ reasoning, đổi base URL ⇒ bắt buộc ô key), `price-suggestions.ts`
(research mục 7, **đối chiếu lại trang pricing lúc implement**; không reasoning: `gpt-4.1-mini 0.40/1.60` (mặc định),
`gpt-4o-mini 0.15/0.60`, `gpt-4.1 2/8`; reasoning (gắn cờ + cảnh báo): `gpt-5-mini 0.25/2.00`, `gpt-5 1.25/10`),
`tasks-section.tsx`; `api.ts` thêm query/mutation. Icon sửa/xoá (`aria-label`), xoá có xác nhận. Ghi chú UI: "không hỗ
trợ model -pro/-codex (chỉ Responses API)".

**Data flow**: admin nhập key (HTTPS) → API zod → `encryptSecret(key, id)` → `api_key_enc` + `key_last4` → GET chỉ trả
last4. Probe: giải mã trong RAM → `fetch` (no redirect, 10s) → phân loại → `{ok, reason}`. Slot: PUT slots → 3 cột FK
(phase 4 đọc khi enqueue).

## Related Code Files

- Create:
  - `packages/shared/src/ai-providers.ts`, `packages/shared/test/ai-providers.test.ts`
  - `packages/db/src/schema/ai-providers.ts`, `packages/db/migrations/0022_ai_providers.sql` (+ snapshot/journal),
    `packages/db/migrations-down/0022_ai_providers.down.sql` (drop 3 cột slot, `ai_models`, `ai_providers`)
  - `apps/api/src/lib/secrets.ts`, `apps/api/src/ai/probe.ts`, `apps/api/src/routes/admin-providers.ts`
  - `apps/api/test/secrets.test.ts`, `apps/api/test/provider-probe.test.ts`, `apps/api/test/admin-providers.test.ts`
  - `apps/web/src/features/admin/providers-section.tsx`, `provider-form.tsx`, `provider-form-model.ts`,
    `provider-form-model.test.ts`, `price-suggestions.ts`, `tasks-section.tsx`
- Modify:
  - `packages/shared/src/index.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/schema/system-settings.ts` (3 cột slot)
  - `apps/api/src/env.ts`, `apps/api/src/index.ts`, `apps/api/src/routes/admin.ts`, `apps/api/src/routes/admin-settings.ts`,
    `apps/api/src/lib/system-settings.ts` (đọc/ghi slot)
  - `apps/api/vitest.config.ts` (env `SECRETS_KEY` cố định), `apps/api/test/isolate-queue.ts` (xoá `ai_providers`,
    đặt lại slot `null`; `afterEach` khôi phục `env.SECRETS_KEY`)
  - `.env.example` (`SECRETS_KEY=` + hướng dẫn `openssl rand -base64 32`)
  - `apps/web/src/features/admin/admin-sections.ts` (mục `providers`, `tasks`), `api.ts`, `admin.css`
  - `apps/web/e2e/admin-settings.spec.ts`
  - `docs/deployment-guide.md` (mục 2 `SECRETS_KEY`; mục 7 backup `SECRETS_KEY` ngoài DB; đổi key = nhập lại key provider),
    `docs/job-queue-worker.md` (provider DB)
- Delete: không.

## Implementation Steps

### Tests Before
1. `apps/api/test/error-classes.test.ts:199` (giá ledger theo bảng) + `admin-access.test.ts` (phase 1) xanh — khoá
   billing không đổi và route admin mới tự bị quét 403.
2. Gate xanh trên code phase 1 → commit nếu có ca thêm.

### Refactor / Implement
3. Shared constants/zod → DB schema → `pnpm --filter @mtl/db generate --name ai_providers` → CHECK (`inList` từ
   `packages/db/src/schema/columns.ts:20`) → down file → migrate.
4. `env.ts` (`SECRETS_KEY`) + `secrets.ts` + `verifyProviderSecrets` ở boot.
5. `probe.ts`.
6. `admin-providers.ts` + `slots` trong `admin-settings.ts`; mount; map lỗi FK `23503` → 409.
7. Web mục Nhà cung cấp + Model tác vụ; docs.

### Tests After
8. `secrets.test.ts`: roundtrip; AAD sai (tráo blob sang provider khác) → throw; sửa 1 byte ct/tag → throw; blob ngắn /
   version ≠ 1 → throw; đổi `env.SECRETS_KEY` giữa 2 ca → blob cũ không giải mã được (không memo); env parse: key 31
   byte / không base64 → lỗi.
9. `admin-providers.test.ts`: tạo openai + compatible; GET không chứa chuỗi key gốc lẫn `api_key_enc`; body sai kèm key →
   400 không chứa key; compatible thiếu base_url / `http://` → 400; key có khoảng trắng giữa → 400; PATCH đổi base_url
   không key → 409 `key_required`, kèm key → 200 + `key_last4` mới; PATCH model có `model_id` → 400 (bất biến); xoá
   model/provider đang gán slot → 409 `in_use`; job active có `payload.llm` (chèn tay dòng `jobs`) tham chiếu provider → 409
   `in_use_by_jobs`; gán model không vision vào OCR → 400; thiếu `SECRETS_KEY` → 409; user thường → 403 (quét phase 1).
10. `provider-probe.test.ts` (`fetchFn` giả): mỗi dòng bảng probe → reason đúng; `redirect: "manual"` được truyền, 302 →
    `redirect`; Gemini 400 `API_KEY_INVALID` → auth; OpenRouter dùng `/key`; compatible 404 `/models` → ping chat;
    timeout → network; key không nằm trong URL.
11. Web unit `provider-form-model.test.ts`: compatible bắt buộc base URL https; thiếu giá → lỗi; gợi ý giá chỉ điền khi
    ô trống, gợi ý reasoning bật cờ + cảnh báo; đổi base URL mà ô key trống → lỗi; model trùng id → lỗi. E2E (không gọi
    mạng ngoài; https bắt buộc nên không dựng endpoint giả local): admin thêm provider `openai` key giả → list chỉ hiện
    `••••last4`, gán slot Dịch, reload còn giữ. Kết quả nút Kiểm tra đã phủ bằng `provider-probe.test.ts` + smoke tay.

### Regression Gate
```bash
pnpm typecheck && pnpm lint
pnpm --filter @mtl/shared test && pnpm --filter @mtl/db test && pnpm --filter @mtl/api test && pnpm --filter @mtl/web test
pnpm --filter @mtl/db generate   # No schema changes
pnpm --filter @mtl/web e2e admin-settings
```
Smoke tay (ghi vào báo cáo cook): Kiểm tra với key thật Anthropic + Gemini + OpenAI + 1 compatible (key đúng và sai).

## Success Criteria

- [x] CRUD provider/model/slot chạy; toàn vẹn slot do FK; xoá bị chặn khi còn slot/job tham chiếu.
- [x] Đổi base_url bắt buộc nhập lại key; `model_id` bất biến.
- [x] Không response/log nào chứa key (test assert chuỗi).
- [x] Probe phân loại đúng theo bảng, không theo redirect, timeout 10s.
- [x] Docs có quy tắc backup + đổi `SECRETS_KEY` = nhập lại key.
- [ ] Smoke tay nút Kiểm tra với key thật — chưa: OpenAI + openai_compatible (không có key trong `.env`, probe chưa kiểm live).
  Đã kiểm live: Anthropic (`x-api-key` + `2023-06-01`: 200 / sai key 401) và Gemini (`x-goog-api-key`: 200 / sai key 400 → auth).
  Giá gợi ý OpenAI đối chiếu lại 2026-11-04 (khớp research; nguồn là WebFetch tóm tắt, admin vẫn phải xác nhận giá).

**Kết quả (2026-11-04)**: xong, review 8.5/10; fix M1 (retry sửa provider từng phần), L1–L4, L6 đã áp (L5 bỏ theo chỉ đạo). Báo cáo:
`plans/reports/from-fullstack-developer-261104-1356-phase-02-ai-providers-report.md`,
`plans/reports/from-code-reviewer-261104-1408-phase-02-review-report.md`.

## Risk Assessment

| Rủi ro | Khả năng × Tác động | Giảm thiểu |
|---|---|---|
| Mất/đổi `SECRETS_KEY` → mọi key không giải mã được | Thấp × Cao | Boot cảnh báo; docs backup ngoài DB; khôi phục = nhập lại key; worker vẫn fallback env khi gỡ slot |
| <!-- red-team --> SSRF qua base URL do admin nhập (probe từ API, job từ worker) | Thấp × TB | Chỉ admin nhập (đã chặn chiếm admin ở phase 1); https bắt buộc; probe không redirect + 10s; lỗi provider không về user (phase 3); không kiểm DNS/IP — chấp nhận theo quyết định rút gọn |
| <!-- red-team --> Admin bị chiếm đổi base_url để hút key | Thấp × Cao | 409 `key_required` khi đổi base_url; kẻ chiếm phải có key thật mới đổi được |
| Header probe Anthropic/Gemini sai so docs mới | TB × Thấp | Smoke test key thật; chỉ ảnh hưởng nút Kiểm tra |
| Giá gợi ý lỗi thời | TB × TB | Chỉ gợi ý, admin bắt buộc xác nhận; nguồn + ngày ghi trong `price-suggestions.ts` |
| Model reasoning đốt hết trần token | TB × TB | Gợi ý mặc định không reasoning; cờ + cảnh báo UI; worker gửi `reasoning_effort: "low"` (phase 3) |

Rollback: revert code; bảng/cột 0022 additive (down file). Job vẫn chạy env suốt phase này.
