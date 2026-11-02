---
phase: 2
title: "Worker: style từ LLM + chọn font"
status: completed
priority: P1
effort: "4h"
dependencies: [1]
---

# Phase 2: Worker — style từ LLM + chọn font

## Overview
LLM dịch trả `style` mỗi item; `font_for` chọn font theo style rồi kind; `build_page_state` ghi `region.style`.

## Requirements
- `TranslateItem.style: Literal["normal","thought","note"] = "normal"`. Giá trị lạ từ LLM → `normal` (validator `mode="before"`), **không** làm hỏng lô (không đẩy vào retry).
- Prompt `translate_batch.md`: thêm mục `style` — `thought` khi text trong ngoặc （…）/(…)/‹…›, độc thoại nội tâm, nói thầm; `note` khi chữ ngoài bóng dạng ghi chú/chú thích/viết tay ngắn; **không chắc → normal**. Ngắn, 3–4 dòng.
- Schema output gửi provider: `TRANSLATE_SCHEMA` **viết tay** ở `worker/mtl_pipeline/providers/base.py:66` (Gemini + Anthropic dùng chung) → thêm `style` enum `normal|thought|note` vào item, **không** đưa vào `required` (LLM bỏ sót vẫn parse được). <!-- Updated: Validation Session 1 - schema provider viết tay -->
- Đo độ chính xác: chạy CLI trên 2–3 chương thật (KO + JA, Gemini), đếm tỉ lệ thought/note, soi 10 mẫu; quá tràn thì siết prompt trước phase 3. <!-- Updated: Validation Session 1 - user đồng ý đo -->
- `font_for(region, style, fonts)` với `fonts = {dialogue, narration, thought?, note?}`: `fonts[style]` nếu có, ngược lại `narration if kind == text_free else dialogue`.
- `handle_translate`: đọc `settings.thought_font` / `note_font` (thiếu → None); truyền style của item; `build_page_state` nhận style per region, chỉ ghi khoá `style` khi ≠ `normal` (state nhỏ, trang không đổi khi không có kiểu).
- `pipeline.py:258` (CLI/bench) cùng chữ ký font mới; `cli.py` thêm `--thought-font`, `--note-font` optional.

## Related Code Files
- Modify: `worker/mtl_pipeline/schema.py` (TranslateItem), `worker/mtl_pipeline/providers/base.py` (`TRANSLATE_SCHEMA`), `worker/mtl_pipeline/prompts/translate_batch.md`, `worker/mtl_pipeline/typeset.py` (`font_for`), `worker/mtl_pipeline/pipeline.py`, `worker/mtl_pipeline/cli.py`, `worker/mtl_worker/handlers.py` (`handle_translate`, `build_page_state`)
- Test: `worker/tests/test_typeset_fit.py` (hoặc file test font_for hiện có), `test_llm_contract.py`, `test_contract_schema.py`, `test_translate_carry.py`

## Implementation Steps (TDD)
1. **Tests before (giữ hành vi cũ)**: `font_for` với style `normal` / thiếu slot → kết quả y hệt hiện tại cho `text_bubble`, `text_free`. Chạy xanh trước khi đổi chữ ký (viết theo chữ ký mới, fail compile → sửa ngay sau).
2. **Tests new**: 
   - `font_for` thought + slot có → font thought; thought + slot trống → theo kind; note tương tự.
   - `TranslateItem.model_validate({"id":"x","style":"shout"}).style == "normal"`; thiếu style → normal.
   - Provider parse: response có `style` được giữ (Gemini + Anthropic, dùng fixture sẵn trong `test_llm_contract.py`).
   - `build_page_state`: region style thought → JSON có `"style":"thought"`; normal → không có khoá; output qua `validate_contract` xanh.
   - `handle_translate` với payload cũ (không `thought_font`) → box font như trước.
3. Implement theo thứ tự: schema → font_for → handlers → pipeline/cli → prompt.
4. **Regression gate**: `cd worker && uv run pytest` (toàn bộ) + `uv run ruff check` nếu repo dùng.

## Success Criteria
- [x] Toàn bộ pytest worker xanh.
- [x] Chạy CLI trên 1 chương mẫu KO/JA (`cli.py` với `--thought-font`) → đếm region thought/note, soi mắt 10 mẫu; ghi số vào report phase.

## Risk Assessment
- LLM gắn `thought` tràn lan → font lạ khắp nơi. Giảm: prompt nhấn "không chắc → normal"; đo ở bước trên; slot trống = không tác động.
- Thêm trường output tăng token nhẹ (~2–4 token/item). Chấp nhận.
- Retry logic lệch id không được coi style sai là lỗi — test riêng.
