---
phase: 2
title: "Hợp đồng font Dẫn truyện API→worker"
status: completed
priority: P1
effort: "2.5h"
dependencies: []
---

# Phase 2: Hợp đồng font Dẫn truyện API→worker

## Overview
Thêm `narration_font` (optional) vào `TranslateSettings`; API luôn gửi giá trị đã resolve; worker chọn font theo `region.kind` khi auto-typeset.

## Requirements
- Functional:
  - API: `narration_font = s.defaultFonts.narration ?? font` với `font = s.defaultFonts.dialogue ?? DEFAULT_DIALOGUE_FONT`.
  - Worker: `text_free` → `narration_font`; còn lại → `font`. Payload thiếu `narration_font` → dùng `font`.
  - CLI `translate` / `run`: thêm `--narration-font` (mặc định None → giống `--font`) để bench/CLI tái hiện đúng hành vi server.
- Non-functional:
  - Job cũ trong hàng đợi (không có trường mới) phải pass `validate_contract` ở worker mới.
  - Không thêm hằng font mặc định thứ hai (fallback = font Thoại).

## Architecture
```
series.default_fonts ──► translateSettings() ──► payload.settings{font, narration_font?}
                                                      │ validate_contract (job-payload.schema.json)
                                                      ▼
handle_translate: fonts = (font, narration_font or font)
  for r in regions: typeset_region(..., font_for(r, *fonts), siblings)
```
- `typeset.py` thêm helper (cạnh `style_for`, cùng quy ước "chữ ngoài bóng" = `text_free`):
  ```python
  def font_for(region: Region, dialogue: str, narration: str) -> str:
      """Chữ ngoài bóng (text_free) dùng font dẫn truyện; còn lại font thoại."""
      return narration if region.kind == "text_free" else dialogue
  ```
- `typeset_region` giữ nguyên chữ ký (vẫn nhận 1 `font_id`); caller chọn font → không đụng test fit hiện có.
- `settings_rev` đã tăng khi `defaultFonts` đổi (`apps/api/src/routes/series.ts` `translationChanged`) → key idempotency translate tự đổi, không cần sửa.

## Related Code Files
- Modify: `packages/shared/src/job.ts` (`TranslateSettings`, dòng ~78–90: `narration_font: z.string().min(1).optional()` + JSDoc)
- Regenerate: `packages/shared/json-schema/job-payload.schema.json`, `claim-response.schema.json` qua `pnpm --filter @mtl/shared emit` (không sửa tay)
- Modify: `apps/api/src/jobs/enqueue.ts` (`translateSettings`, dòng 209)
- Modify: `worker/mtl_pipeline/typeset.py` (`font_for`)
- Modify: `worker/mtl_worker/handlers.py` (dòng 223, 253)
- Modify: `worker/mtl_pipeline/pipeline.py` (`translate_dir`: tham số `narration_font_id: str | None = None`, dòng 180, 226)
- Modify: `worker/mtl_pipeline/cli.py` (dòng 52, 59, 98: `--narration-font`)
- Tests: `worker/tests/test_typeset_fit.py` (`font_for`), `worker/tests/test_contract_schema.py` (payload có/không `narration_font` đều hợp lệ), test API kiểm payload `chapter.translate` (tìm test đang assert `settings` trong `apps/api/test/` — vd. `worker-protocol.test.ts` / `chapters.test.ts`)
- Docs: `docs/typeset-layout-contract.md` mục "Mặc định auto-typeset" (thêm bullet font Dẫn truyện + fallback); grep `docs/` cho mô tả payload `settings.font` và cập nhật nếu có

## Implementation Steps
1. Shared: thêm trường optional; chạy `emit`; xem diff 2 file JSON schema chỉ thêm `narration_font` (không vào `required`).
2. API: resolve trong `translateSettings`; test: series có `narration` → payload có đúng giá trị; không có → bằng `font`.
3. Worker `typeset.py`: `font_for` + test 3 case (`text_bubble`, `text_free`, `text_free` khi narration == dialogue).
4. `handlers.py`: `s = p["settings"]; font = s["font"]; narration = s.get("narration_font") or font`; truyền `font_for(r, font, narration)`.
5. `pipeline.py` + `cli.py`: tham số/option mới, fallback về `font_id`.
6. Contract test: payload `chapter.translate` có và không có `narration_font` đều pass.
7. Chạy: `cd worker && uv run pytest tests/test_typeset_fit.py tests/test_contract_schema.py tests/test_pipeline_stage2.py` (dùng runner thực tế của repo), rồi `pnpm -r typecheck && pnpm --filter api test`.
8. Cập nhật docs.

## Success Criteria
- [x] Series có font Dẫn truyện = BeVietnamPro, Thoại = Bangers: box của `text_free` có `font_family = BeVietnamPro-Regular`, `text_bubble` = Bangers.
- [x] Series không chọn Dẫn truyện: mọi box ra font Thoại (giống hiện tại).
- [x] Payload cũ không có `narration_font` pass contract + typeset bình thường.
- [x] Mọi test worker/API/shared xanh; JSON schema sinh từ `emit`, không sửa tay.

## Risk Assessment
- **Thứ tự deploy**: schema có `additionalProperties: false` và worker validate bằng schema đóng gói kèm worker (`MTL_SCHEMA_DIR`, `modal_app.py:55`). API mới gửi `narration_font` tới worker cũ → bị reject. → **Deploy worker trước, API sau.** Ghi rõ trong commit/PR.
- Series từng chọn Dẫn truyện (trước đây vô tác dụng) sẽ bắt đầu áp dụng ở lần dịch kế tiếp — đúng ý nghĩa ô cài đặt; chương đã dịch không đổi cho tới khi dịch lại.
- `text_free` không đồng nghĩa dẫn truyện → hint ở form (Phase 1) + người dùng đổi font từng box trong editor.
- Rollback: revert API trước (ngừng gửi trường), worker mới vẫn chạy với payload cũ.
