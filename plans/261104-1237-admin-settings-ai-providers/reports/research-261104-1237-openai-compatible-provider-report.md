# Research: provider OpenAI + OpenAI-compatible cho worker (2026-11-04)

Chỉ nghiên cứu, không sửa code. Nguồn ghi cuối mỗi mục. Ghi chú độ tin cậy: trang docs đọc qua WebFetch (tóm tắt bởi model nhỏ) + đọc thẳng source SDK `openai` 3.45.0 (PyPI, cài vào scratchpad). Mục nào "chưa xác minh" = từ trí nhớ/không có trang xác nhận.

## 0. Hiện trạng worker (đã đọc)
- `anthropic.py`, `gemini.py`: dùng **SDK chính thức** (`anthropic`, `google-genai`), client inject được (`client=` để test), `max_retries=0` (hàng đợi lo retry), không có httpx trực tiếp trong provider (chỉ gemini bắt `httpx.HTTPError`).
- Hợp đồng `base.py`: `_call()` -> (text, TokenUsage); `guard_output_tokens`; `parse_ocr/translate/proofread` (json.loads + pydantic, lỗi -> `ProviderError("schema")`); `classify_status` (429 rate_limit retry; 401/403 auth không retry; None/408/409/5xx provider retry; 4xx khác provider không retry); `ErrorClass = provider|rate_limit|schema|auth`.
- `make_provider(name, tier)` đọc model từ env -> phải đổi: nhận cfg (api_key, model, base_url...) theo job.
- Deps: `anthropic`, `google-genai`, `httpx`; lock đang có `httpx2` (anthropic 1.15 kéo httpx2). `openai` 3.45.0 cũng chỉ cần `httpx2, anyio, jiter, pydantic, sniffio` -> **không thêm dep nặng mới**, hầu hết đã có sẵn trong lock.
- `TranslateItem.style` trong pydantic: validator `mode="before"` đưa mọi giá trị lạ/None về `"normal"` -> nhận `null` an toàn.

## 1. Chat Completions vs Responses -> chọn **Chat Completions**, một đường code
- OpenAI: Chat Completions "remains supported", Responses được khuyên cho dự án mới, không deprecate. Chat Completions: `response_format`; Responses: `text.format`. (migrate-to-responses)
- Endpoint compatible (DeepSeek, xAI, OpenRouter, vLLM, Ollama...) chủ yếu chỉ có `/chat/completions`. Một đường code = Chat Completions cho cả OpenAI chính chủ lẫn compatible, khác nhau chỉ ở vài cờ (mục 2, 4).
- Mất gì: tool hosted/state/`previous_response_id` - ta không dùng. Model chỉ-Responses (họ `*-pro`, `*-codex`) không chạy được -> chấp nhận, ghi chú trong UI "không hỗ trợ model -pro/-codex". Từ GPT-5.4 Chat Completions không cho tool-calling với reasoning_effort != none: ta không dùng tool nên không ảnh hưởng.
- Rủi ro: OpenAI có thể ưu tiên tính năng mới ở Responses. Thấp cho tác vụ OCR/dịch/JSON. Đánh giá: **khuyến nghị 1**.

Nguồn: https://developers.openai.com/api/docs/guides/migrate-to-responses

## 2. Structured output
### 2.1 Điều kiện `strict: true` (docs)
- Root phải là object (không `anyOf` ở root). Mọi object `additionalProperties: false`. **Mọi key trong `properties` phải nằm trong `required`**; optional = union với null (`["string","null"]`), key vẫn required.
- Giới hạn: <= 5000 property, <= 10 tầng lồng, <= 120k ký tự tên/enum, <= 1000 enum. Không hỗ trợ `allOf/not/if/then/else/dependent*`. `minLength/pattern/min/maxItems...` OK với model không fine-tune.
- Có `refusal` field (có thể không theo schema) -> kiểm tra trước khi parse. `json_schema.name` bắt buộc (`[A-Za-z0-9_-]{1,64}`), `strict` mặc định **false** -> phải đặt true tường minh.
- Lần đầu dùng schema mới có latency thêm (cache sau).

### 2.2 So với schema trong base.py
| Schema | Kết quả |
|---|---|
| `OCR_SCHEMA` | OK: mọi field required, additionalProperties false. |
| `PROOFREAD_SCHEMA` | OK. |
| `TRANSLATE_SCHEMA` | **VI PHẠM**: `items[].style` có trong `properties` nhưng không trong `required` -> OpenAI strict trả 400 `invalid_json_schema`. `context_notes` đã required. |
- Không sửa schema gốc (anthropic/gemini dùng chung, `style` optional là chủ ý). Thêm helper chuyển đổi **chỉ cho OpenAI**:

```python
def strict_schema(s: dict) -> dict:
    """Bản strict cho OpenAI: mọi property required; property vốn optional -> nullable."""
    s = copy.deepcopy(s)
    def walk(n):
        if n.get("type") == "object":
            req = set(n.get("required", []))
            for k, v in n["properties"].items():
                walk(v)
                if k not in req:
                    t = v["type"]; v["type"] = [t, "null"] if isinstance(t, str) else t + ["null"]
                    if "enum" in v: v["enum"] = [*v["enum"], None]
            n["required"] = list(n["properties"]); n["additionalProperties"] = False
        elif n.get("type") == "array":
            walk(n["items"])
    walk(s); return s
```
- `style: null` -> pydantic validator đã về `"normal"`. Không cần đổi model. Thêm test: schema qua `strict_schema` có `required == properties.keys()` ở mọi object.

### 2.3 Request mẫu
```python
resp = client.chat.completions.create(
    model=m, messages=[{"role": "system", "content": system}, {"role": "user", "content": content}],
    response_format={"type": "json_schema",
                     "json_schema": {"name": "translate", "strict": True, "schema": strict_schema(schema)}},
    max_completion_tokens=max_tokens)
```

### 2.4 Fallback khi compatible không hỗ trợ json_schema
- Biết hỗ trợ: DeepSeek docs chỉ nói `json_object` (không nhắc json_schema, chưa xác nhận); xAI hỗ trợ `json_schema` (additionalProperties mặc định false; từ chối HTTP 400 vài keyword lạ); OpenRouter: tuỳ model+provider, "strict enforcement varies", dùng `provider.require_parameters=true` để lỗi thay vì lặng lẽ bỏ qua.
- Không có mã lỗi chuẩn cho "không hỗ trợ json_schema" (OpenRouter docs: "không nêu mã"). Vậy **không dựa vào mã lỗi làm cơ chế chính**.
- Khuyến nghị: **cờ cấu hình** trên cấu hình provider: `structured_output: "json_schema" | "json_object"` (OpenAI chính chủ cố định json_schema; compatible mặc định `json_object`, admin bật json_schema nếu endpoint hỗ trợ). Thêm **auto-downgrade 1 lần** (an toàn): `BadRequestError` (400/422) mà `str(e.body)` khớp `/response_format|json_schema|structured/i` -> gọi lại 1 lần với `json_object`, nhớ trạng thái trong instance provider (không tính attempt). Hạ cấp không đổi cost đáng kể (call lỗi 400 không tính token).
- Chế độ `json_object`:
  - Docs OpenAI: phải có chữ "JSON" trong messages, nếu không 400. DeepSeek cũng yêu cầu chữ "json" + ví dụ. -> append vào system: `"Trả về DUY NHẤT một JSON object đúng schema sau: <json.dumps(schema)>"`.
  - DeepSeek: output không hợp lệ bị thay bằng khoảng trắng, `finish_reason=stop` nhưng content rỗng -> coi content rỗng/chỉ trắng = `ProviderError("schema")`.
  - Validate = `parse_ocr/translate/proofread` hiện có (pydantic) - đủ, không cần jsonschema thêm. Thêm bước gỡ fence ```` ```json ```` trước `json.loads` trong nhánh này (endpoint bỏ qua response_format lặng lẽ sẽ trả prose/fence).
- Rủi ro còn lại: endpoint "chấp nhận nhưng bỏ qua" response_format -> chỉ lộ ra ở lỗi parse (class `schema`, đã có).

Nguồn: https://developers.openai.com/api/docs/guides/structured-outputs ; https://api-docs.deepseek.com/guides/json_mode ; https://openrouter.ai/docs/features/structured-outputs ; https://docs.x.ai/docs/guides/structured-outputs

## 3. Vision
```python
{"type": "text", "text": f"id={c.id}"},
{"type": "image_url", "image_url": {"url": "data:image/png;base64," + b64, "detail": "high"}}
```
- Theo kiểu hiện tại (text id + ảnh xen kẽ, cùng 1 user message). PNG/JPEG/WEBP/GIF tĩnh đều được; `proofread` dùng `image/jpeg`.
- Giới hạn docs mới: tổng payload <= 512 MB/request, <= 1500 ảnh/request, <= 30k patch/ảnh (vượt = từ chối, không tự resize). Crop manga nhỏ nên không chạm. (Docs cũ ghi 20MB/ảnh; đừng dựa vào số này cho compatible - mỗi provider tự giới hạn, chưa kiểm.)
- `detail`: `low | high | auto (mặc định) | original` (original tuỳ model, dành cho OCR/ảnh dày). Tile-based (gpt-4o/4.1): low = 85 token cố định, tile 512px = 170 token. **Khuyến nghị `"high"` cho OCR** (low có thể mất chữ nhỏ); chỉ gửi `detail` khi là OpenAI chính chủ, bỏ với compatible (nhiều server bỏ qua hoặc có thể từ chối field lạ - chưa xác minh).
- Cảnh báo: **DeepSeek API là text-only** (chưa xác minh trong docs lần này, theo hiểu biết trước) -> OCR không chạy được; cấu hình compatible cần cờ `vision: bool`, nếu false thì chặn dùng cho bước OCR/proofread ở UI.

Nguồn: https://developers.openai.com/api/docs/guides/images-vision

## 4. Usage, reasoning, max tokens
- Field: `resp.usage.prompt_tokens`, `completion_tokens`, `total_tokens`; `prompt_tokens_details.cached_tokens`; `completion_tokens_details.reasoning_tokens` (xác nhận trong `openai/types/completion_usage.py`, đều `Optional`).
- **`completion_tokens` ĐÃ gồm reasoning tokens** (reasoning là tập con, tính tiền như output). => `output_tokens = completion_tokens`, **KHÔNG cộng** `reasoning_tokens` (khác Gemini ở `gemini.py`: `candidates + thoughts`). Cộng thêm sẽ đếm đôi.
- `cached_tokens` là tập con của `prompt_tokens`; `TokenUsage` chưa có trường cached -> cost bị tính cao hơn thực (an toàn, YAGNI; bỏ qua).
- `usage` có thể `None`/thiếu ở compatible -> `input=0, output=0` sẽ làm lọt guard và ledger sai: nếu `usage is None` thì raise `ProviderError("provider", ...)` hoặc ước lượng; đề xuất raise (ledger đúng quan trọng hơn).
- `max_tokens` **deprecated**, không tương thích o-series/reasoning; `max_completion_tokens` giới hạn **tổng** token sinh ra (visible + reasoning). Compatible phần lớn chỉ biết `max_tokens` (DeepSeek docs dùng `max_tokens`) -> rule: OpenAI chính chủ (`base_url is None` hoặc host `api.openai.com`) gửi `max_completion_tokens`; compatible gửi `max_tokens`. (xAI/OpenRouter có thể nhận cả hai, chưa xác minh.)
- Reasoning vs guard: `reasoning_effort` mặc định `medium` -> model reasoning (họ gpt-5) có thể đốt hết `max_completion_tokens` (4096) vào suy luận, trả `finish_reason="length"` + content rỗng. Vì `max_completion_tokens` chặn tổng, `completion_tokens` không vượt limit nên `guard_output_tokens` (`>`) không kích hoạt -> phải check `finish_reason == "length"` riêng -> `ProviderError("schema", usage=[usage])` (tương đương `max_tokens` bên anthropic).
- Tắt/giảm reasoning: `reasoning_effort` giá trị `none|minimal|low|medium|high|xhigh|max`, **mỗi model chỉ hỗ trợ tập con** (docs: GPT-6 Astra từ chối `none` bằng 400; 6.1 Sol không `none`/`minimal`; họ 5.6 mặc định medium). Từ trí nhớ (chưa xác minh trên docs hiện hành): gpt-5/mini/nano hỗ trợ `minimal`, gpt-5.1+ hỗ trợ `none`. => Không hardcode bảng trong code lõi; cấu hình `reasoning_effort: str | None` theo provider/model, mặc định gợi ý: gpt-5* = `"minimal"`, gpt-4.x = bỏ qua (không phải model reasoning, gửi sẽ 400). Compatible: không gửi (OpenRouter dùng `reasoning:{effort}` riêng - bỏ qua YAGNI).
- `temperature`: model reasoning chỉ nhận mặc định (1) -> gửi 0.2 như gemini sẽ 400 (từ trí nhớ; docs lần này không xác nhận). **Bỏ `temperature`** hoàn toàn cho OpenAI; compatible cũng bỏ (KISS).
- Khuyến nghị mặc định để tránh rủi ro guard: model **không reasoning** (gpt-4.1-mini) làm standard; model reasoning chỉ khi admin chọn, kèm effort thấp.

Nguồn: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create ; https://developers.openai.com/api/docs/guides/reasoning ; source SDK `openai/types/completion_usage.py`

## 5. Map lỗi -> `ErrorClass`
SDK `openai`: `AuthenticationError`(401), `PermissionDeniedError`(403), `NotFoundError`(404), `BadRequestError`(400), `RateLimitError`(429), `APIStatusError`(còn lại, có `.status_code`, `.code`, `.body`), `APIConnectionError`/`APITimeoutError`. `APIError.code/.param/.type` có sẵn (xác nhận `_exceptions.py`).

| Tình huống | Class | retryable | Ghi chú |
|---|---|---|---|
| 401 | auth | no | key sai. |
| 403 | auth | no | OpenAI: vùng không hỗ trợ / thiếu quyền; OpenRouter: guardrail/moderation/budget. |
| 404 | provider | no | model không tồn tại hoặc sai `base_url` (thông báo nêu cả hai). |
| 400 chung / `context_length_exceeded` | provider | no | request quá lớn, chạy lại vô ích (đúng với `classify_status` hiện tại). |
| 429 rate limit | rate_limit | yes | đọc `retry-after`. |
| 429 `insufficient_quota` / `credit_balance_exhausted` / `*_spend_limit_exceeded` / `*_usage_limit_exceeded` | **auth**, no | no | Docs: "retrying billing, spend, quota errors won't restore access". Nếu để `rate_limit` (không tính attempt) hàng đợi sẽ lặp vô hạn. **Cần xử lý riêng** ở provider, `classify_status` chỉ có status không đủ. |
| 402 (OpenRouter hết credit) | auth, no | no | `classify_status` hiện trả provider/no -> sửa 402 -> auth. |
| 408/409/5xx/503 `server_is_overloaded`, 502 (OpenRouter) | provider | yes | đã đúng. |
| `APIConnectionError`/timeout | provider | yes | |
| `finish_reason == "content_filter"` hoặc `message.refusal` | schema | n/a | parity anthropic `refusal` -> `schema`, kèm `usage`. |
| `finish_reason == "length"` | schema | n/a | xem mục 4. |
| 200 nhưng không có `choices` (OpenRouter trả lỗi trong body 200) hoặc content rỗng | provider / schema | n/a | OpenRouter: lỗi giữa chừng có thể HTTP 200 -> check `resp.choices` và `getattr(resp, "error")`. Content rỗng -> schema. |

```python
except openai.RateLimitError as e:
    if (e.code or "") in QUOTA_CODES:  # insufficient_quota, credit_balance_exhausted, *_limit_exceeded
        raise ProviderError("auth", f"{self.name} hết hạn mức: {e.message}", retryable=False) from e
    raise ProviderError("rate_limit", str(e), parse_retry_after(e.response.headers.get("retry-after"))) from e
except openai.APIStatusError as e:
    cls, retry = (("auth", False) if e.status_code == 402 else classify_status(e.status_code))
    raise ProviderError(cls, f"{self.name} {e.status_code}: {e.message}", retryable=retry) from e
except (openai.APIConnectionError, openai.APITimeoutError) as e:   # Timeout là con của Connection; để rõ ràng
    raise ProviderError("provider", f"{self.name} transport: {e}") from e
```
- Thứ tự `except`: `RateLimitError` trước `APIStatusError`; `APITimeoutError` kế thừa `APIConnectionError`.
- Gợi ý: nhận diện quota bằng `e.code` HOẶC `e.type == "insufficient_quota"` (docs: `error.type` có thể vẫn là insufficient_quota).

Nguồn: https://developers.openai.com/api/docs/guides/error-codes ; https://openrouter.ai/docs/api-reference/errors

## 6. "Kiểm tra kết nối" rẻ nhất (Node API gọi)
Nguyên tắc: gọi endpoint liệt kê model (không tốn token). 401/403 = key sai; 200 = ok. Timeout 10s, không retry, không log key. Không bao giờ trả key lại client.

**OpenAI**
```http
GET https://api.openai.com/v1/models HTTP/1.1
Authorization: Bearer sk-...
```
200: `{"object":"list","data":[{"id","created","object":"model","owned_by"}]}`. Có thể kiểm `model` có trong `data[].id`. Hạn chế: key "restricted" thiếu quyền Models read trả 403 dù chat dùng được (từ trí nhớ). Header `OpenAI-Organization`/`OpenAI-Project` tuỳ chọn, bỏ qua.

**Anthropic**
```http
GET https://api.anthropic.com/v1/models?limit=1 HTTP/1.1
x-api-key: sk-ant-...
anthropic-version: 2023-06-01
```
Docs `models/list` (2026-11) ví dụ ghi `Authorization: Bearer` + `anthropic-version: 2026-10-21`; header `x-api-key` + `2023-06-01` là cách quen thuộc và là cách SDK hiện dùng (chưa xác minh docs mới còn chấp nhận). **Probe 1 lần với key thật khi implement**; tốt nhất chạy qua cùng SDK worker? Node không dùng SDK nên raw. Query: `limit` 1-1000 (mặc định 20), phân trang `after_id`. Response có `data[].id`, `lifecycle`, `capabilities` (có `image_input`, `structured_outputs`) - dùng được để cảnh báo model không có vision.

**Gemini**
```http
GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1 HTTP/1.1
x-goog-api-key: AIza...
```
Docs ví dụ dùng `?key=$KEY`; dùng header để key không rơi vào access log/URL. Key sai -> **400** `API_KEY_INVALID` (không phải 401), khớp xử lý trong `gemini.py`: coi 400 + body chứa `API_KEY_INVALID` là auth. `pageSize` mặc định 50, tối đa 1000. Chi tiết model: `GET /v1beta/models/{model}` (`inputTokenLimit`, `outputTokenLimit`, `supportedGenerationMethods`). Header `x-goog-api-key` cho models.list: chưa xác minh trên trang list (docs ví dụ dùng `?key=`); header hoạt động ở generateContent theo hiểu biết trước.

**OpenAI-compatible (generic)**
```http
GET {base_url}/models HTTP/1.1
Authorization: Bearer <key>
```
- `base_url` phải gồm phần path, vì SDK nối `/chat/completions` vào đó: OpenRouter `https://openrouter.ai/api/v1`, xAI `https://api.x.ai/v1`, DeepSeek `https://api.deepseek.com` (có/không `/v1` đều chạy theo docs DeepSeek). Chuẩn hoá bỏ `/` cuối; bắt buộc `https://` ngoại trừ localhost (chống SSRF: Node server gọi URL do admin nhập -> chặn private IP/metadata `169.254.169.254` trừ khi chủ động cho phép).
- Có `/models`: 200 ok, 401/403 sai key. Lưu ý **OpenRouter `/models` công khai, không cần key -> luôn 200, không kiểm tra key**. Dùng `GET https://openrouter.ai/api/v1/key` (Bearer) để xác thực key (docs nhắc endpoint này; trả thông tin budget). Cần special-case host `openrouter.ai`.
- `/models` trả 404/405/501 hoặc không có (nhiều proxy/vLLM tối giản): fallback **ping chat 1 token**:
```http
POST {base_url}/chat/completions
Authorization: Bearer <key>
Content-Type: application/json

{"model":"<model>","messages":[{"role":"user","content":"ping"}],"max_tokens":1}
```
  200 -> ok; 401/403 -> key sai; 404 -> sai model/URL; 402/429 quota -> báo hết credit. Tốn <=~10 token (với model reasoning `max_tokens:1` có thể 400 hoặc rỗng - coi 200/400 `max_tokens` không phải lỗi auth; chỉ cần phân biệt auth). Chỉ dùng khi /models không khả dụng.
- DeepSeek có `GET /models`, xAI có `GET /v1/models` (từ trí nhớ, docs lần này không xác nhận). Quy tắc generic ở trên đủ, không cần special-case ngoài OpenRouter.
- Phản hồi cho UI: trả `{ok, reason: "auth"|"not_found"|"network"|"quota"|"unknown", httpStatus, modelFound?}`, không trả body provider thô (có thể chứa thông tin nhạy cảm).

Nguồn: https://developers.openai.com/api/reference/resources/models/methods/list ; https://platform.claude.com/docs/en/api/models-list ; https://aistudio.google.com/api-reference/models/list-models ; https://openrouter.ai/docs/api-reference/errors

## 7. Giá hiện hành (USD / 1M token), tra 2026-11-04
Nguồn: https://developers.openai.com/api/docs/pricing , tầng Standard, ngữ cảnh <= 272K. WebFetch tóm tắt bằng model nhỏ -> **đối chiếu lại bằng mắt trước khi hardcode** (Batch/Flex/Priority giá khác).

| Model | Input | Cached in | Output | Ghi chú |
|---|---|---|---|---|
| gpt-5-nano | 0.05 | 0.005 | 0.40 | reasoning, rẻ nhất; OCR manga có thể yếu |
| gpt-4o-mini | 0.15 | 0.075 | 0.60 | không reasoning, vision tốt, đời cũ |
| gpt-5.6-luna | 0.20 | 0.02 | 1.20 | mới (chưa rõ vision/effort) |
| gpt-5.4-nano | 0.20 | 0.02 | 1.25 | |
| gpt-5-mini | 0.25 | 0.025 | 2.00 | reasoning |
| gpt-4.1-mini | 0.40 | 0.10 | 1.60 | **không reasoning**, vision, strict json_schema |
| gpt-5.4-mini | 0.75 | 0.075 | 4.50 | |
| gpt-5 | 1.25 | 0.125 | 10.00 | tương đương gpt-5.1 |
| gpt-4.1 | 2.00 | 0.50 | 8.00 | |
| gpt-5.2 | 1.75 | 0.175 | 14.00 | |
| gpt-5.4 | 2.50 | 0.25 | 15.00 | |
| gpt-5.5 | 5.00 | 0.50 | 30.00 | |
| gpt-4.1-nano | không liệt kê trên trang | | | bỏ |

Đề xuất điền sẵn vào `PRICES_PER_MTOK` (ghi chú trong bảng Node `prices.ts` cũng cần đồng bộ):
- Standard: `gpt-4.1-mini (0.40, 1.60)` mặc định; thêm `gpt-5-mini (0.25, 2.00)`, `gpt-4o-mini (0.15, 0.60)`.
- Premium (hiệu đính): `gpt-5 (1.25, 10.0)`, `gpt-4.1 (2.0, 8.0)`.
- Lý do: 4.1-mini không reasoning -> chi phí và guard dự đoán được; so Haiku 5.5 (0.10/0.50) và Gemini 2.5 Flash (0.30/2.50) cùng dải. Giá chưa có trong bảng -> `UnknownPrice` đã chặn (đúng); compatible tự do nhập model -> cần cách báo giá (xem câu hỏi mở).
- Nhớ: giá lưu cho `completion_tokens` đã gồm reasoning, `prompt_tokens` tính nguyên (không giảm cached).

## 8. SDK `openai` hay httpx thuần -> **SDK `openai`**
- Khớp quy ước hiện tại: cả 2 provider đã dùng SDK chính thức, client inject để test, `max_retries=0`. Dùng httpx thuần sẽ tự viết: retry-after, parse lỗi, multipart/serialization, kiểu lỗi - phá DRY/KISS.
- `OpenAI(api_key=..., base_url=..., max_retries=0, timeout=60)` nhận `base_url` thẳng -> compatible gần như miễn phí. Dùng chung 1 class `OpenAIProvider(name="openai"|"openai_compatible")`, khác nhau ở cờ (official: `max_completion_tokens`, `detail`, strict json_schema; compatible: `max_tokens`, json_object mặc định, không `detail`).
- Chi phí dep: SDK 3.45.0 yêu cầu `httpx2, anyio, jiter, pydantic, sniffio, typing-extensions` - gần như đã có (anthropic 1.15 cùng bộ); thêm `jiter`/`distro` đã có trong lock. `pyproject` thêm `openai>=3.45` (kiểm lại version thực khi `uv add`; số 3.45.0 là bản mới nhất cài được hôm nay; lịch sử breaking change giữa major chưa đánh giá).
- Không dùng `client.beta.chat.completions.parse` / helper Pydantic: nó tự dựng schema từ model pydantic; ta đã có JSON schema thô + parse riêng -> dùng `create()` thô cho đồng nhất 3 provider.
- Tạo client **theo job** với key được truyền vào; không đọc env (`OpenAI()` mặc định đọc `OPENAI_API_KEY`: luôn truyền `api_key=` tường minh và `base_url=` tường minh - không để SDK đọc `OPENAI_BASE_URL` từ env của worker). Đóng client cuối job (`client.close()`), không rò connection.
- Điểm kiến trúc: `make_provider` đổi chữ ký nhận cấu hình; `thinking_config`/env model trong `__init__.py` giữ cho gemini/anthropic hoặc cũng chuyển sang cfg.

## Skeleton (không phải code chốt)
```python
class OpenAIProvider:
    def __init__(self, name, model, api_key, base_url=None, *, json_mode="json_schema",
                 reasoning_effort=None, vision=True, client=None):
        self.official = base_url is None or "api.openai.com" in base_url
        self.client = client or openai.OpenAI(api_key=api_key, base_url=base_url, max_retries=0, timeout=90)
    def _call(self, system, content, schema, max_tokens, guard=None):
        kw = {"model": self.model, "messages": [...]}
        kw["max_completion_tokens" if self.official else "max_tokens"] = max_tokens
        if self.reasoning_effort: kw["reasoning_effort"] = self.reasoning_effort
        # response_format theo self.json_mode (mục 2.3/2.4)
        resp = self.client.chat.completions.create(**kw)   # + except map lỗi (mục 5)
        if not resp.choices or resp.usage is None: raise ProviderError(...)
        usage = TokenUsage(provider=self.name, model=self.model,
                           input_tokens=resp.usage.prompt_tokens, output_tokens=resp.usage.completion_tokens)
        guard_output_tokens(usage, guard)
        ch = resp.choices[0]
        if ch.finish_reason in ("length", "content_filter") or ch.message.refusal or not (ch.message.content or "").strip():
            raise ProviderError("schema", ..., usage=[usage])
        return ch.message.content, usage
```

## Xếp hạng khuyến nghị
1. **Chat Completions + SDK `openai`, 1 class, cờ per-config** (đề xuất chính). Ưu: 1 đường code, khớp pattern, base_url sẵn. Nhược: model chỉ-Responses không dùng được.
2. Chat Completions + httpx thuần: nhẹ hơn một dep nhưng tự viết lỗi/retry; không đáng.
3. Responses cho OpenAI + Chat cho compatible: 2 đường code, nhân đôi test; loại.

## Giới hạn nghiên cứu
- Docs đọc qua WebFetch tóm tắt (có thể thiếu chi tiết/sai số); trang docs mới có model mà tôi chưa biết (gpt-5.6, gpt-6) -> bảng hỗ trợ `reasoning_effort`/`vision` theo model chưa đủ.
- Chưa gọi API thật (không có key): mọi hành vi lỗi/400 là từ docs + trí nhớ, cần smoke test.
- Chưa kiểm docs DeepSeek/xAI/OpenRouter về vision, `max_completion_tokens`, `/models`.
- Không đánh giá chất lượng OCR manga KO của các model OpenAI (cần bench trên bộ mẫu).

## Câu hỏi còn mở
1. Cách hiển thị/điền giá cho model tự nhập ở compatible (bảng giá do admin nhập? nếu không có -> `UnknownPrice` chặn job; hay cho nhập tay price in/out trong cấu hình)?
2. Compatible cần cờ `vision` trong cấu hình? (DeepSeek không có vision -> OCR/proofread phải chặn.)
3. `reasoning_effort` nên là trường cấu hình công khai hay chỉ default theo tiền tố model? Cần smoke test thực để biết gpt-5-mini nhận `minimal`, gpt-5.x nhận `none`, và xác nhận 400 khi gửi `temperature`.
4. Anthropic `/v1/models`: header `x-api-key` + `2023-06-01` còn đúng không (docs mới ghi Bearer + 2026-10-21)?
5. Gemini `models.list` bằng header `x-goog-api-key` có chạy không (docs ví dụ `?key=`)?
6. Quota 429 (`insufficient_quota`) thuộc `auth` hay thêm `ErrorClass` mới (vd `quota`)? Đề xuất tạm `auth`+non-retryable; cần thống nhất với Node worker queue và UI.
7. SSRF guard cho `base_url` do admin nhập: cho phép localhost/private IP (Ollama, vLLM tự host) hay chặn? Quyết định sản phẩm.
8. Có hỗ trợ lưu `cached_tokens` trong `TokenUsage` để tính giá chính xác không (hiện bỏ, over-estimate)?
