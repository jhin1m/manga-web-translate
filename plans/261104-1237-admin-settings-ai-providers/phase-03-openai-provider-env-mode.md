---
phase: 3
title: "OpenAIProvider + compatible chạy bằng env/CLI"
status: completed-pending-smoke
priority: P1
effort: "1d"
dependencies: []
---

<!-- red-team -->
# Phase 3: `OpenAIProvider` + compatible chạy bằng env/CLI

## Overview

Tách từ giai đoạn 3 cũ (red team #9): code worker thuần, **không đổi hợp đồng, không bump pipeline**. Thêm
`OpenAIProvider` (SDK `openai`, Chat Completions) cho `openai` + `openai_compatible` (D4, T8), chọn bằng `--provider`/env
như gemini/anthropic hiện nay. Cùng lúc làm cứng log + thông báo lỗi worker (T9) vì áp cho mọi provider. Phase 4 chỉ còn
việc nối cấu hình DB vào provider đã có sẵn và đã đo được.

## Requirements

- Functional:
  - `mtl-worker --provider openai` (env `OPENAI_API_KEY`, model `MTL_OPENAI_MODEL` mặc định `gpt-4.1-mini`, premium
    `MTL_OPENAI_PREMIUM_MODEL` mặc định `gpt-4.1`) và `--provider openai_compatible` (env `MTL_OPENAI_COMPAT_BASE_URL`,
    `MTL_OPENAI_COMPAT_API_KEY`, `MTL_OPENAI_COMPAT_MODEL`, `MTL_OPENAI_COMPAT_JSON=json_schema|json_object`) chạy đủ 4
    loại job LLM. Cờ `MTL_OPENAI_REASONING=1` → model reasoning (env mode của cờ `ai_models.reasoning`).
  - Hành vi `OpenAIProvider` (T8):
    - structured output **1 cơ chế**: cờ `structured_output` của provider (`openai` cố định `json_schema`) + tự hạ
      `json_object` **1 lần** khi 400/422 body khớp `/response_format|json_schema/i`, nhớ trên instance;
    - `finish_reason` `length`/`content_filter`, `message.refusal`, content rỗng → `schema` kèm usage; `usage is None`
      hoặc không `choices` → `provider` không retry;
    - 429 `insufficient_quota`/`credit_balance_exhausted`/`*_limit_exceeded` (theo `code` hoặc `type`) và 402 → `auth`
      không retry; 429 khác → `rate_limit` + `retry-after`; còn lại `classify_status` (`base.py:235`, không sửa hàm chung);
      `APIConnectionError`/`APITimeoutError` → `provider` retry;
    - `max_completion_tokens` (openai) / `max_tokens` (compatible); `reasoning_effort: "low"` chỉ khi openai **và** cờ
      reasoning (không hardcode tiền tố model); không gửi `temperature`; `detail: "high"` chỉ khi openai.
  <!-- red-team -->
  - `jobs.error` (message gửi `fail`) chỉ còn lớp lỗi + câu chung: `"<provider> HTTP <status> <error_class>"` (thiếu status
    → bỏ phần HTTP); lỗi bất ngờ → `"internal: <TênException>"`. Text thô của provider chỉ ở log cục bộ (đã redact).
  - Log worker: formatter redact mọi chuỗi giống key (`sk-…`, `sk-ant-…`, `sk-or-…`, `AIza…`, `Bearer …`) + key đã đăng
    ký (phase 4 đăng ký key theo job) — áp cho mọi bản ghi, kể cả traceback của `log.exception`. Logger `anthropic`,
    `google_genai`, `openai`, `httpx`, `httpcore` ghim WARNING kể cả `-v`; `-v` chỉ đặt DEBUG cho `mtl_worker`/`mtl_pipeline`.
- Non-functional: không đổi JSON schema / `PIPELINE_VERSION`; client SDK luôn nhận `api_key`/`base_url` tường minh (không
  để SDK tự đọc `OPENAI_API_KEY`/`OPENAI_BASE_URL`).

## Architecture

- `worker/pyproject.toml:6` thêm `openai>=3.45,<4` (`uv add`, kiểm version thật); `uv.lock`.
- `worker/mtl_pipeline/providers/openai.py`:
  - `strict_schema(schema)` (research mục 2.2): mọi object `required = list(properties)`, property vốn optional →
    nullable; deepcopy, không sửa `TRANSLATE_SCHEMA` gốc (`base.py`, anthropic/gemini dùng chung).
  - `OpenAIProvider(name, model, api_key, base_url=None, structured_output="json_schema", reasoning=False, client=None)`;
    `official = name == "openai"`; client `openai.OpenAI(api_key=api_key, base_url=base_url, max_retries=0, timeout=90)`.
  - `_call(system, content, schema, max_tokens, guard)` theo skeleton research; messages system + user (text `id=…` +
    `image_url` data URI xen kẽ như anthropic/gemini); `json_object` thêm vào system "Trả về DUY NHẤT một JSON object đúng
    schema sau: <json>" + gỡ fence ```` ```json ```` trước parse; `output_tokens = completion_tokens` (đã gồm reasoning).
  - `ocr_page`/`translate`/`proofread_page` dùng lại `build_*`/`parse_*` của `base.py` như 2 provider kia.
- `worker/mtl_pipeline/providers/__init__.py:13` `make_provider(name, tier)` thêm nhánh `openai`, `openai_compatible`
  (đọc env ở đây rồi truyền tường minh); thiếu key/base URL → `ValueError` rõ ràng.
- `worker/mtl_pipeline/providers/base.py:112` `ProviderError` thêm kwargs `provider: str | None`, `status: int | None`
  (mặc định None — caller cũ không vỡ); `public_message()` dựng câu chung. Raise site gắn `provider`/`status`:
  `anthropic.py:68,73,77,86`, `gemini.py:80,87,98`, `openai.py`.
- `worker/mtl_worker/runner.py:54` `classify_provider_error` → `JobFailure(cls, e.public_message(), …)`; `:331` nhánh
  `except Exception` → `JobFailure("internal", f"internal: {type(e).__name__}")`; chi tiết chỉ qua `log.exception`.
- <!-- red-team --> `worker/mtl_worker/log_redact.py`: `REDACT_PATTERNS`, `register_secret(s)` / `clear_secrets()` (set cấp
  process, phase 4 gọi theo job), `RedactingFormatter(logging.Formatter)` redact **chuỗi đã format** (gồm `exc_text`
  traceback). `worker/mtl_worker/main.py:114` thay `basicConfig` bằng handler dùng `RedactingFormatter`; root INFO; `-v` →
  `mtl_worker`, `mtl_pipeline` DEBUG; 5 logger SDK/HTTP → WARNING.
- `worker/mtl_worker/main.py:76` `--provider` choices thêm `openai`, `openai_compatible`.
- Giá env: `apps/api/src/billing/prices.ts:5` + `worker/mtl_pipeline/providers/base.py:25` thêm `gpt-4.1-mini (0.40/1.60)`,
  `gpt-4.1 (2/8)` (đối chiếu trang pricing) để job env OpenAI không tính giá model lạ. Chỉ thêm dữ liệu bảng, không đổi
  cơ chế (billing sửa 1 lần ở phase 4). Model compatible env → giá đắt nhất (bảo thủ, như cũ).

**Data flow**: CLI/env → `make_provider` → `OpenAIProvider` → Chat Completions → `(text, TokenUsage{provider, model})` →
`parse_*` → handler → usage tới API như cũ; lỗi → `ProviderError(public)` → `fail.message` câu chung; log cục bộ redact.

## Related Code Files

- Create:
  - `worker/mtl_pipeline/providers/openai.py`, `worker/mtl_worker/log_redact.py`
  - `worker/tests/test_openai_provider.py`, `worker/tests/test_log_redact.py`
- Modify:
  - `worker/pyproject.toml`, `worker/uv.lock`, `worker/mtl_pipeline/providers/__init__.py`, `base.py`, `anthropic.py`,
    `gemini.py`, `worker/mtl_worker/runner.py`, `worker/mtl_worker/main.py`
  - `worker/tests/test_worker_runner.py` (kỳ vọng message mới), `worker/tests/test_llm_contract.py` (`ProviderError` có
    `provider/status`)
  - `apps/api/src/billing/prices.ts` (2 dòng giá), `.env.example` (biến `MTL_OPENAI_*`)
  - `docs/job-queue-worker.md` ("Chạy local": `--provider openai|openai_compatible`; "Phân loại lỗi": quota → auth, câu
    lỗi chung)
- Delete: không. `Deps`/handlers không đổi ở phase này → fake deps trong test (`test_worker_runner.py:172`,
  `test_proofread.py:170,210`, `test_translate_carry.py:34`) không phải sửa.

## Implementation Steps

### Tests Before
1. `cd worker && uv run pytest` xanh; chú ý khoá: `test_llm_contract.py:74,92,126,134,142,171,187,386,471`
   (shape request + phân loại lỗi anthropic/gemini, `TRANSLATE_SCHEMA.style` không required), `test_proofread.py:75`
   (tier premium env), `test_worker_runner.py:215,230,236` (lớp lỗi gửi `fail`).
2. Thêm `test_worker_runner.py`: ca "lỗi provider → `fail` đúng `error_class`, `retry_after`, usage" tách khỏi nội dung
   message (để đổi message mà vẫn khoá phân loại).

### Refactor / Implement
3. `uv add openai`; `openai.py` + `strict_schema`; nhánh `make_provider`; choices CLI.
4. `ProviderError(provider, status)` + `public_message`; raise site anthropic/gemini; `classify_provider_error` + nhánh
   `except Exception`.
5. `log_redact.py` + cấu hình logging `main.py`.
6. Bảng giá 2 nơi; docs.

### Tests After
7. `test_openai_provider.py` (client giả ghi kwargs):
   - openai: `max_completion_tokens`, `response_format.json_schema.strict is True`, schema mọi object `required ==
     list(properties)` + `style` nullable, `detail == "high"`, không `temperature`; `reasoning=True` → `reasoning_effort ==
     "low"`, `False` → không có.
   - compatible: `max_tokens`; `structured_output="json_object"` → chỉ dẫn schema trong system, không `detail`, không
     `reasoning_effort` kể cả cờ bật; fence được gỡ.
   - 400 body `response_format` → gọi lại 1 lần `json_object`, lần sau dùng luôn; 400 khác → provider không retry.
   - `length`/`refusal`/content rỗng → `schema` kèm usage; `usage=None` → provider.
   - 429 `insufficient_quota` → auth không retry; 429 thường → rate_limit + retry_after; 402/401/403 → auth; 500 →
     provider retry; `APIConnectionError` → provider retry.
   - `strict_schema` không sửa dict gốc; `make_provider("openai")` truyền `api_key` tường minh (đặt `OPENAI_BASE_URL` giả
     trong env → client không dùng).
8. `test_worker_runner.py`: lỗi provider có body `"... sk-proj-abcdef1234567890 ..."` → `fail.message` = câu chung, không
   chứa body; lỗi bất ngờ → `"internal: ValueError"`.
9. `test_log_redact.py`: `log.exception` với exception chứa `sk-ant-…`/`AIza…` → output đã redact (cả traceback); key
   đăng ký qua `register_secret` bị thay `[redacted]`; `-v` không đưa `openai`/`httpx`/`httpcore`/`anthropic`/
   `google_genai` xuống DEBUG.
10. `pnpm --filter @mtl/api test` (`prices.ts` thêm dòng không đổi ca cũ).

### Regression Gate
```bash
cd worker && uv sync && uv run pytest && uv run ruff check . && cd ..
pnpm --filter @mtl/api test
```
Smoke tay (ghi vào báo cáo cook): `mtl-worker --provider openai` dịch 1 chương bằng `gpt-4.1-mini`;
`--provider openai_compatible` trỏ OpenRouter (`json_schema` → tự hạ nếu cần) dịch 1 chương; log `-v` không có key.

## Success Criteria

- [x] `OpenAIProvider` đủ hành vi T8, test từng nhánh xong (worker pytest 334 lúc xong phase).
- [ ] Smoke tay key thật — chưa: `--provider openai` (gpt-4.1-mini, 1 chương) + `openai_compatible` (OpenRouter, 1 chương) + quét log `-v` không có key.
- [x] Kiểm `worker/modal_app.py` có cài `openai`: ảnh dùng `pip_install_from_pyproject` (`modal_app.py:35`), pyproject có `openai`.
- [x] `jobs.error` không còn text thô của provider; log worker không lộ key kể cả traceback và `-v`.
- [x] Không đổi hợp đồng/`PIPELINE_VERSION`; gemini/anthropic hành vi như cũ (Tests Before xanh).

**Kết quả (2026-11-04)**: xong code, review 8.5/10 (review chung phase 1–3; finding chính: ghim logger nhắm sai thư viện HTTP — đã xử lý ở
vòng review fix). Lệch đáng nhớ: quota 429 dùng hậu tố `_spend_limit_exceeded`/`_usage_limit_exceeded` (không `*_limit_exceeded`, vì
`rate_limit_exceeded` thường bị nhận nhầm là auth); tự hạ `json_object` chỉ cho `openai_compatible`; `usage None` → `provider` không retry.
Báo cáo: `plans/reports/from-fullstack-developer-261104-1337-phase-03-openai-provider-report.md`,
`plans/reports/from-code-reviewer-261104-1345-phase-01-03-review-report.md`.

## Risk Assessment

| Rủi ro | Khả năng × Tác động | Giảm thiểu |
|---|---|---|
| Compatible bỏ qua `response_format` / trả prose | TB × TB | `json_object` + chỉ dẫn schema + gỡ fence; lỗi parse = `schema` (attempt có hạn) |
| Model reasoning đốt hết token → content rỗng | TB × TB | Cờ reasoning → `reasoning_effort: "low"`; `length` → schema; UI khuyên model không reasoning (phase 2) |
| Quota hết bị coi rate_limit → lặp vô hạn | TB × Cao | Mã quota + 402 → auth (test) |
| Câu lỗi chung làm khó chẩn đoán | TB × Thấp | Chi tiết vẫn ở log worker (đã redact); web hiện lớp lỗi như cũ (`job-error.ts`) |
| SDK `openai` major mới đổi API | Thấp × TB | Pin `<4`; test client giả bắt khi nâng |
| Regex redact bắt nhầm chuỗi thường | Thấp × Thấp | Pattern có tiền tố + độ dài tối thiểu; chỉ ảnh hưởng log |

Rollback: revert code worker (không đổi hợp đồng nên không cần đụng API).
