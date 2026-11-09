---
title: "Phase 1: Self-host first run"
status: done
---

# Phase 1: Self-host first run

## Overview

Thêm provider đầu tiên là dịch được; form gợi ý đúng model; chặn model worker chắc chắn lỗi; đổi mặc định ngôn ngữ và font; bổ sung docs.

## Requirements

- Tự gán chỉ khi `env.MTL_LOCAL_MODE` và DB chưa có provider; chỉ điền ô trống.
- `translate` = model đầu trong form; `ocr`, `proofread` = model đầu có vision, không có thì để trống.
- Provider Anthropic có gợi ý `claude-haiku-5-5` (giá 0.1/0.5, vision), đối chiếu lại giá khi làm.
- Chặn với provider Anthropic: `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-*`, `claude-mythos-*`; lý do: worker luôn gửi `thinking: {type: "disabled"}`, API trả 400. Provider đã lưu không bị xoá.
- Series tạo mới mọi loại truyện: nguồn `en`, giữ `page_format` theo loại. DB default và series cũ không đổi.
- `readingOrder`: `(src === "ja" || src === "en") && fmt === "pages"` → `rtl`.
- Font thoại mặc định `KomikaText-Regular`.

## Related Code Files

- Modify: `apps/api/src/routes/admin-providers.ts`, `apps/api/test/admin-providers.test.ts`
- Modify: `packages/shared/src/ai-providers.ts`, `packages/shared/src/series-lang.ts`
- Modify: `apps/web/src/features/admin/price-suggestions.ts`, `provider-form-model.ts`, `api.ts` (`providerError`)
- Modify: `apps/web/src/features/series/comic-kind-picker.tsx`
- Modify: `apps/api/src/jobs/enqueue.ts` (`DEFAULT_DIALOGUE_FONT`), `worker/mtl_pipeline/fonts.py` (`DEFAULT_FONT`), `worker/scripts/font_glyph_check.py` (`PREFERRED_DEFAULTS`)
- Regenerate: `worker/fonts/manifest.json`, `apps/web/public/fonts/manifest.json`
- Modify: `docs/self-host.md`

## Implementation Steps

1. Test trước cho `POST /providers`: local + DB trống; không local; đã có provider; model không vision; không có model; slot đã gán không bị ghi đè.
2. Trong transaction của `POST /providers`: nếu local mode và `body.models.length > 0`, gọi `lockSystemSettings` trước, đếm `aiProviders`; bằng 0 thì sau khi insert chọn model theo thứ tự `body.models` (map qua `model_id`, không tin thứ tự `returning`), đọc `systemSlots` trong cùng transaction, điền ô null, `saveSlots`.
3. Thêm helper chặn model ở `packages/shared/src/ai-providers.ts` (nhận `type` + `modelId`). Kiểm trong `AiProviderInput.superRefine`; `POST /providers/:id/models` kiểm theo `type` của provider, trả `fail(400, "model_unsupported")`. Xem `AiModelPatch` có cho đổi `model_id` không, có thì kiểm luôn.
4. Form: `validateDraft` dùng cùng helper, báo cạnh ô model và gợi ý Haiku 5.5; thêm `model_unsupported` vào `providerError`.
5. `price-suggestions.ts`: thêm `ANTHROPIC_SUGGESTIONS`, nối vào `suggestionsFor`; ghi chú nguồn giá và ngày đối chiếu như các danh sách khác. Với Anthropic, ghi chú dưới danh sách phải nói đúng giới hạn thay vì câu `-pro / -codex`.
6. `series-lang.ts`: đổi `COMIC_KIND_SETTINGS`, `readingOrder`, thêm test các cặp `ja`/`en`/`ko` × định dạng. Sửa comment `comic-kind-picker.tsx`.
7. Font: đổi 3 hằng, đặt `KomikaText-Regular` đầu `PREFERRED_DEFAULTS`, chạy lại script sinh manifest và sync-fonts. Kiểm `scripts/typeset-parity.ts` và fixture có phụ thuộc font mặc định không.
8. `docs/self-host.md`: thêm provider, model khuyên dùng, tự gán ở lần đầu, đổi model ở Model tác vụ, OCR local mặc định và trường hợp chọn AI.

## Thay đổi khi làm

- Form bắt buộc có ít nhất một model khi tạo provider: provider không có model sẽ bỏ lỡ lần tự gán duy nhất.

## Todo

- [x] Tự gán slot ở local mode, có test
- [x] Gợi ý model Anthropic
- [x] Chặn model ở form và API
- [x] Mặc định nguồn tiếng Anh và thứ tự đọc
- [x] Font mặc định và manifest
- [x] Docs self-host

## Success Criteria

- [x] Local mode, DB trống: tạo provider xong 3 slot đúng quy tắc; trang Model tác vụ hiện đúng mà không tải lại
- [x] Không local mode: slot không đổi
- [x] Provider thứ hai không đổi slot, kể cả ô đang trống
- [x] Model bị chặn nhận lỗi rõ ở form và API; `claude-haiku-5-5` và provider khác không ảnh hưởng
- [x] Tạo series Manga: nguồn `en`, dạng trang, đọc phải sang trái

## Risk Assessment

- Người dùng raw Hàn/Nhật/Trung phải đổi nguồn tay; docs phải nói rõ.
- Comic phương Tây dạng trang bị đảo thứ tự; đổi định dạng để tránh.
- Series cũ chưa chọn font đổi sang KomikaText từ lần dịch sau.
- Danh sách chặn có thể lỗi thời khi có model mới; giữ ở một chỗ.
