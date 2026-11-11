---
phase: 2
title: "Worker: thu gợi ý + prompt"
status: completed
priority: P2
effort: "4h"
dependencies: [1]
---

# Phase 2: Worker – thu gợi ý + prompt

## Overview

Mỗi lần gọi LLM dịch lô sẽ trả thêm 2 mảng `new_terms` và `pronoun_pairs`. Worker gom chúng qua các lô của job, khử
trùng, cắt theo hợp đồng ở phase 1, rồi đưa vào `result`. `context_notes` đổi thành ghi chú cộng dồn. **Không gọi LLM
thêm lần nào, không đổi payload.**

## Context

- `worker/mtl_pipeline/providers/base.py:69-89` là `TRANSLATE_SCHEMA` (`required: items, context_notes`,
  `additionalProperties: false`). `base.py:238-246` là `parse_translate`: JSON sai thì ném `ProviderError("schema")`,
  lô bị thử lại hoặc tách trang.
- `worker/mtl_pipeline/providers/openai.py:56-79`: `strict_schema` biến mọi property thành required, gồm cả property mới.
  Anthropic (`anthropic.py:120`) và Gemini (`gemini.py:114`) dùng nguyên schema.
- `worker/mtl_pipeline/schema.py:160-196` chứa `RollingContext`, `TranslateItem`, `TranslateResult`.
- `worker/mtl_pipeline/translate.py:35-43` là `ChapterTranslation`. `translate.py:85-127` là `_translate_once` (1 call
  + retry, lần 2 hỏng thì dùng kết quả lần 1). `translate.py:130-176` là `translate_chapter` (lô hỏng schema thì tách
  từng trang; 1 trang vẫn hỏng thì vào `failed`).
- `worker/mtl_worker/handlers.py:254-337` là `handle_translate`. `handlers.py:340-350` có `_cut_utf16` và `_carry`.
  `handlers.py:249-251` có các hằng `CARRY_*`.
- `worker/mtl_worker/runner.py:335-341`: result sai hợp đồng thì job fail `internal`. **Một gợi ý rác không được làm
  hỏng lô đã dịch xong.**
- `worker/mtl_pipeline/prompts/translate_batch.md` là prompt hiện tại. `context_notes` đang giới hạn ≤ 300 ký tự và chỉ
  yêu cầu "nhân vật mới", nên ghi chú cũ bị thay mất.

## Files

| Thao tác | File |
|---|---|
| Sửa | `worker/mtl_pipeline/schema.py` |
| Sửa | `worker/mtl_pipeline/providers/base.py` |
| Sửa | `worker/mtl_pipeline/translate.py` |
| Sửa | `worker/mtl_pipeline/prompts/translate_batch.md` |
| Sửa | `worker/mtl_worker/handlers.py` |
| Sửa | `worker/mtl_worker/__init__.py` (`PIPELINE_VERSION = "0.11.0"`) |
| Tạo | `worker/tests/test_translate_learned.py` |
| Sửa (nếu cần) | `worker/tests/test_contract_schema.py`, `worker/tests/test_llm_contract.py` |

## Implementation steps

1. **`schema.py`**:
   - Thêm `TermKind = Literal["person", "place", "term"]`.
   - `class NewTerm(BaseModel)`: `source: str`, `target: str`, `kind: TermKind = "term"`. Validator `mode="before"` đổi
     giá trị lạ hoặc thiếu thành `"term"`, theo mẫu `_known_style` ở l.187-190.
   - `class PronounPair(BaseModel)`: `speaker`, `listener`, `address` (đều là `str`).
   - `TranslateResult` thêm `new_terms: list[NewTerm] = []` và `pronoun_pairs: list[PronounPair] = []` (dùng
     `Field(default_factory=list)`).
2. **`base.py`**:
   - `TRANSLATE_SCHEMA` thêm property `new_terms` (array of object `{source, target, kind enum}`, mọi field required)
     và `pronoun_pairs` (array of object `{speaker, listener, address}`). Thêm cả hai vào `required` của gốc để Gemini
     luôn trả (trả `[]` chỉ tốn vài token). Không dùng `maxItems`, vì structured output của các provider hỗ trợ không
     đều; giới hạn nằm ở prompt và ở bước 4.
   - `parse_translate`: `items` và `context_notes` giữ nguyên độ chặt. Hai mảng mới parse lỏng bằng helper
     `_lenient(model, raw)`: không phải list thì trả `[]`, mục nào `ValidationError` hoặc không phải dict thì bỏ.
     **Không bao giờ raise vì hai mảng này.**
3. **`translate.py`**:
   - `_translate_once` trả thêm `new_terms` và `pronoun_pairs` của kết quả được dùng (cùng `res` cung cấp `notes`).
     Đổi kiểu trả về thành tuple 5 phần tử hoặc NamedTuple nhỏ, do người làm chọn; cập nhật mọi chỗ gọi trong file.
   - `ChapterTranslation` thêm `new_terms: list[NewTerm]` và `pronoun_pairs: list[PronounPair]`.
   - `translate_chapter` gom qua các lô. Mục đầu tiên thắng. Khoá là `casefold(NFC(strip(source)))`, với cặp xưng hô là
     tuple `(speaker, listener)` đã chuẩn hoá. Trang hỏng (nhánh `failed`) không đóng góp gì. Mode `none` (bench) vẫn gom.
4. **`handlers.py`**:
   - Thêm `LEARNED_TERMS_MAX = 50`, `LEARNED_PRONOUNS_MAX = 30` (khớp `MAX_LEARNED_*` của shared) và
     `TERM_TEXT_MAX = 200`, `PERSON_MAX = 80`, `ADDRESS_MAX = 120`.
   - Hàm `_learned(tr) -> dict[str, Any]` đặt cạnh `_carry`. Với mỗi mục: `strip`, rồi `_cut_utf16` theo giới hạn,
     rồi `strip` lại (cắt có thể để lại khoảng trắng cuối). Bỏ mục có field rỗng. Với cặp xưng hô, bỏ thêm cặp có
     speaker/listener là `"?"` và cặp mà speaker trùng listener (casefold). Khử trùng lần nữa sau khi cắt, rồi giới
     hạn số phần tử. **Chỉ thêm key khi list không rỗng**, để result khi không có gợi ý giống hệt bản cũ.
   - `handle_translate` (l.337): `return {"type": "chapter.translate", "pages": out, "carry": _carry(tr.context), **_learned(tr)}`.
5. **`translate_batch.md`**:
   - Mô tả `context`: "các dòng nguồn + bản dịch gần nhất; `characters` (nhân vật đã gặp); `notes` (ghi chú — có thể
     mang từ chương trước của cùng truyện). Giữ nhất quán; khi mâu thuẫn, `glossary` và `pronoun_rules` thắng."
   - Thay dòng `context_notes` bằng: "ghi chú cập nhật ≤ 300 ký tự (giá trị cuối; ban đầu 500, hạ sau smoke LLM thật): giữ điều trong `context.notes` còn đúng, thêm
     nhân vật mới, quan hệ, cặp xưng hô đã chốt — dùng cho lô sau và chương sau."
   - Thêm `new_terms`: "tên riêng / thuật ngữ cần dịch thống nhất cả truyện (tên người, địa danh, tổ chức, chiêu thức,
     vật phẩm đặc biệt) xuất hiện trong lô mà CHƯA có trong `glossary`. `source` = đúng chuỗi trong nguồn; `target` =
     bản dịch bạn đã dùng; `kind`: person | place | term. Không đưa từ thông dụng, câu, tiếng động, tên nhóm dịch /
     watermark. Tối đa 5 (giá trị cuối; ban đầu 8, hạ sau smoke LLM thật); không có → []."
   - Thêm `pronoun_pairs`: "cặp xưng hô đã dùng trong lô mà CHƯA có trong `pronoun_rules`: `speaker`, `listener` = tên
     nhân vật (như trường `speaker`, không dùng "?"); `address` = cách speaker xưng / gọi listener (VD "anh/em",
     "tôi/cậu"). Chỉ khi rõ ai nói với ai. Tối đa 5; không có → []."
   - Giữ câu về ngoặc kép cong vì áp dụng cho mọi trường, kể cả trường mới.
6. Nâng `PIPELINE_VERSION` lên `"0.11.0"`. **Không** sửa `MIN_PIPELINE_VERSION` và `PIPELINE_VERSION` của API
   (`apps/api/src/env.ts:62-79`).

## Tests (`cd worker && uv run pytest -q`, `uv run ruff check`, kèm mypy nếu CI chạy)

Tạo mới `test_translate_learned.py`, test tên tiếng Anh, mô tả hành vi:
- `parse_translate` khi JSON không có `new_terms`/`pronoun_pairs`, hoặc có nhưng là `null`, chuỗi, hay list lẫn mục
  hỏng: không raise, mục hỏng bị bỏ, `kind` lạ thành `"term"`.
- `translate_chapter` qua 2 lô (`ScriptedProvider` ở `tests/test_llm_contract.py:212`): gom, mục trùng (khác hoa
  thường, NFD/NFC) chỉ giữ một. Lô 2 trang hỏng schema rồi tách: các trang tách vẫn được gom. Trang hỏng hẳn không góp.
- `handle_translate` (dựng job như `tests/test_translate_carry.py`): provider trả `source` 300 ký tự, emoji đúng mốc
  cắt, chuỗi rỗng, `speaker="?"`, speaker trùng listener, 60 thuật ngữ. Kết quả:
  `validate_contract("job-result", result)` qua, đúng giới hạn, không có mục rỗng.
- `handle_translate` khi LLM không trả gì mới: result **không có** key `new_terms`/`pronoun_pairs`.
- `strict_schema(TRANSLATE_SCHEMA)` (test sẵn có ở `test_openai_provider.py:294`) vẫn đạt: gốc có 4 property required.
- `load_prompt("translate_batch")` có chứa `new_terms` và `pronoun_pairs`, để chặn trường hợp đổi schema mà quên prompt.

## Risks

| Rủi ro | K×T | Giảm thiểu |
|---|---|---|
| Token ra mỗi lô tăng, lô dày chữ chạm guard 4096 (`base.py:44`), lô bị tách từng trang và tốn tiền hơn | TB×TB | Prompt giới hạn 8/5 mục, notes ≤ 500 ký tự. Phase 6 đo +15,4% nên đã hạ xuống 5/3/300 (giá trị cuối, đo lại +3,1%) |
| Model không theo schema mới (provider tương thích OpenAI, `json_object`) | TB×Thấp | Parse lỏng. Thiếu field thì không có gợi ý, lô vẫn xong |
| Gợi ý làm result sai hợp đồng, job fail `internal` | Thấp×Cao | `_learned` cắt và lọc. Test với dữ liệu rác chạy qua `validate_contract` |
| Ghi chú cộng dồn làm prompt input dài thêm | Thấp×Thấp | Trần 300 ký tự, ban đầu 500 (hợp đồng cho phép tới 2000) |
| `page.ocr_region` cũng gọi `translate_batch`, nên LLM trả thêm 2 mảng | Thấp×Thấp | Handler OCR vùng bỏ qua chúng. Chỉ tốn vài token `[]` |

## Rollback

Revert phase này: worker không gửi key mới, API mới không có gợi ý nào và vẫn chạy. Payload không đổi, nên API và
worker deploy hay revert theo thứ tự nào cũng được.
