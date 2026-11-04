# Phase 3 report: OpenAIProvider + log redact (worker)

Status: DONE_WITH_CONCERNS (code + gate xong; smoke tay với key thật chưa chạy)

## Files
Created: `worker/mtl_pipeline/providers/openai.py`, `worker/mtl_worker/log_redact.py`, `worker/tests/test_openai_provider.py` (32), `worker/tests/test_log_redact.py` (9).
Modified: `worker/pyproject.toml` (`openai>=3.45,<4`, resolved 3.45.0), `worker/uv.lock`, `providers/__init__.py` (make_provider openai/openai_compatible + `_required_env`/`_flag`), `providers/base.py` (`ProviderError.provider/status/public_message()`, 2 giá gpt-4.1*), `providers/anthropic.py`, `providers/gemini.py` (gắn provider/status), `mtl_worker/runner.py` (message chung, `internal: <Exc>`, log chi tiết cục bộ), `mtl_worker/main.py` (choices, `configure_logging`), `tests/test_worker_runner.py` (+4 ca; FakeClient.fail ghi thêm `message`), `tests/test_llm_contract.py` (+3 assert), `apps/api/src/billing/prices.ts` (+2 dòng), phase-03 file (tick). Không đổi PIPELINE_VERSION/hợp đồng.

## Gate
- `uv run pytest`: 334 passed (baseline 286). `ruff check .` clean, `ruff format` sạch.
- `pnpm --filter @mtl/api test`: 331 passed; `typecheck` clean (cây có thay đổi đồng thời của agent phase 1).

## Deviations / quyết định nhỏ
1. Quota 429: plan ghi `*_limit_exceeded`, nhưng `rate_limit_exceeded` (rate limit thường của OpenAI) khớp -> bị coi auth sai. Test bắt được. Dùng hậu tố `_spend_limit_exceeded`/`_usage_limit_exceeded` + `insufficient_quota`/`credit_balance_exhausted` (theo code hoặc type).
2. Tự hạ `json_object` chỉ cho `openai_compatible`; `openai` chính chủ cố định json_schema (400 ở đó là bug schema thật, không nên che).
3. Env `MTL_OPENAI_COMPAT_JSON` mặc định `json_schema` (khớp mặc định cột DB phase 2 + tự hạ), giá trị sai -> ValueError.
4. Client official truyền `base_url=https://api.openai.com/v1` tường minh (nếu None SDK đọc `OPENAI_BASE_URL`).
5. `ProviderError` không có `provider` (lỗi parse/guard) -> `public_message()` = `llm <class>`; text thô chỉ ở log (`log.warning` trong `classify_provider_error`).
6. `usage None`/không choices -> `provider`, `retryable=False` (hiểu "không retry"; runner map thành `internal`).
7. Compatible env không có tier premium (không có biến premium trong plan); model compat không có giá tĩnh worker/API -> API dùng giá đắt nhất (đúng plan).
8. Lỡ chạy `git stash`/`pop` trong ~vài giây để kiểm baseline format; đã pop sạch, stash list rỗng, thay đổi agent phase 1 còn nguyên. Không commit/stage.

## Pending cho orchestrator
`.env.example` thêm (trong khối worker):
```
# --- Worker: OpenAI / OpenAI-compatible (chọn bằng mtl-worker --provider openai|openai_compatible hoặc MTL_PROVIDER) ---
OPENAI_API_KEY=
# MTL_OPENAI_MODEL=gpt-4.1-mini
# MTL_OPENAI_PREMIUM_MODEL=gpt-4.1
# MTL_OPENAI_REASONING=0            # 1 = model reasoning: gửi reasoning_effort=low (chỉ OpenAI chính chủ)
MTL_OPENAI_COMPAT_BASE_URL=         # vd https://openrouter.ai/api/v1
MTL_OPENAI_COMPAT_API_KEY=
MTL_OPENAI_COMPAT_MODEL=
# MTL_OPENAI_COMPAT_JSON=json_schema   # json_schema | json_object (json_schema tự hạ json_object 1 lần nếu endpoint từ chối)
```
`docs/job-queue-worker.md`:
- "Chạy local": `mtl-worker --provider openai` (cần `OPENAI_API_KEY`; model `MTL_OPENAI_MODEL` mặc định `gpt-4.1-mini`, premium `MTL_OPENAI_PREMIUM_MODEL` mặc định `gpt-4.1`) và `--provider openai_compatible` (cần `MTL_OPENAI_COMPAT_BASE_URL`, `_API_KEY`, `_MODEL`; `MTL_OPENAI_COMPAT_JSON`). Model compatible không có giá tĩnh -> billing tính giá đắt nhất. DeepSeek (text-only) không chạy OCR/proofread.
- "Phân loại lỗi": 429 hết hạn mức (`insufficient_quota`, `credit_balance_exhausted`, `*_spend_limit_exceeded`, `*_usage_limit_exceeded`) và 402 -> `auth` (không retry); `jobs.error`/`fail.message` chỉ là câu chung `"<provider> HTTP <status> <error_class>"` hoặc `"internal: <TênException>"`; chi tiết chỉ ở log worker đã redact.
- Log: formatter redact key (`sk-…`, `sk-ant-…`, `sk-or-…`, `AIza…`, `Bearer …`); `-v` chỉ DEBUG cho `mtl_worker`/`mtl_pipeline`, logger `anthropic/google_genai/openai/httpx/httpcore` ghim WARNING.

## Chưa làm / hỏi
- Smoke tay (OpenAI `gpt-4.1-mini` 1 chương; compatible OpenRouter) cần key thật, chưa chạy.
- Modal image: kiểm `modal_app.py` có cài deps từ `uv.lock` không (không thuộc quyền sở hữu; nếu pin danh sách riêng cần thêm `openai`).
- Câu mở: `usage None` nên retry hay không (đang không).
