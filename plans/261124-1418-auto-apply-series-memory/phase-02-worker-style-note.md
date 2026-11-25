---
phase: 2
title: "Worker: style_note"
status: completed
priority: P2
effort: "3h"
dependencies: [1]
---

# Phase 2: Worker – style_note

<!-- Updated: Red Team Session 1 - schema luôn có style_note, đủ 4 provider, cắt UTF-16, làm sạch -->

## Goal

Khi series chưa có Giọng văn, lô dịch trả thêm `style_note` một dòng mô tả giọng văn AI đã dùng. Không thêm lượt gọi
LLM, không đổi payload job.

## Context

- `worker/mtl_worker/handlers.py:163-167`: đọc `p["settings"]["style_prompt"]`, khác rỗng thì gộp vào `rules`.
  `_cut_utf16` ở l.352-367 (cắt như zod `.max()`).
- `worker/mtl_pipeline/translate.py` (l.~120-206) gom `context_notes`, `new_terms`, `pronoun_pairs`.
- `worker/mtl_pipeline/schema.py:220-222` model output; `schema.py:37` `validate_contract`.
- `worker/mtl_pipeline/providers/base.py`: `TRANSLATE_SCHEMA` (l.88-116), `translate_user_text` (l.224-233), parse lỏng
  (l.267-289). Hằng `TRANSLATE_SCHEMA` được dùng ở `providers/anthropic.py:120`, `openai.py:239` (có `strict_schema`,
  l.56-57, 129), `gemini.py:114`, `bench.py:188`.
- `worker/mtl_pipeline/prompts/translate_batch.md`; `worker/mtl_worker/__init__.py:25` `PIPELINE_VERSION = "0.12.0"`.

## Files to Create / Modify

- Sửa: `worker/mtl_pipeline/schema.py`, `providers/base.py`, `providers/anthropic.py`, `providers/openai.py`,
  `providers/gemini.py`, `providers/bench.py` (chỉ khi cần), `translate.py`, `prompts/translate_batch.md`,
  `worker/mtl_worker/handlers.py`, `worker/mtl_worker/__init__.py`.
- Test: cạnh các test translate, provider và handlers trong `worker/tests/`.

## Tasks & Steps

1. `TRANSLATE_SCHEMA` luôn có `style_note: string` (không đổi theo cờ, để mọi provider dùng chung một hằng). OpenAI
   `strict_schema` biến nó thành bắt buộc, nên model trả `""` khi không cần.
2. `want_style = settings.style_prompt.strip() == ""`, đưa vào JSON gửi LLM (`translate_user_text`). Đây là dữ liệu
   nội bộ worker, không phải payload job.
3. Prompt: "`style_note`: nếu `want_style` là true, ≤ 150 ký tự, một dòng, mô tả giọng văn đã dùng (giọng nhân vật chính,
   mức trang trọng, giữ hay dịch tên riêng). Chỉ mô tả, không viết mệnh lệnh. Ngược lại trả `""`."
4. Parse lỏng: không phải chuỗi thì coi như rỗng. Không bao giờ raise.
5. `translate.py` giữ `style_note` khác rỗng của lô thành công gần nhất. `handlers.py` làm sạch rồi đưa vào result khi
   khác rỗng: gộp mọi khoảng trắng và xuống dòng thành một dấu cách, bỏ ký tự điều khiển, `_cut_utf16(…, 150)`.
6. `PIPELINE_VERSION = "0.13.0"`.

## Verification

- `cd worker && uv run pytest -q`, `uv run ruff check`.
- Test: `want_style` false thì result không có key; chuỗi rác (số, object, `""`) thì không có key; chuỗi nhiều dòng
  thành một dòng; 149 ký tự + 1 emoji được cắt đúng ≤ 150 đơn vị UTF-16; `strict_schema` của OpenAI hợp lệ khi có
  `style_note`.

## Risk

- Người dùng cố ý để trống Giọng văn (sau khi xoá bản AI) thì mỗi lô vẫn tốn ~50–80 token ra cho `style_note` mà API bỏ đi.
  Đã được người dùng chấp nhận (plan P6). Phase 5 đo.
