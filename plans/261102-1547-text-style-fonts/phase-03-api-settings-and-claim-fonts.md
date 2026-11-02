---
phase: 3
title: "API: settings + font inputs"
status: completed
priority: P1
effort: "2h"
dependencies: [1]
---

# Phase 3: API — settings + font inputs

## Overview
Series nhận slot `thought`/`note`; snapshot dịch gửi font slot khi có; claim tải font tuỳ chỉnh của slot mới.

## Requirements
- `apps/api/src/routes/series.ts:47`: `default_fonts` thêm `thought: FontId, note: FontId` (partial). `assertKnownFonts` kiểm cả khoá mới (kiểm hàm có lặp mọi value không).
- `enqueue.ts translateSettings`: thêm `thought_font: s.defaultFonts.thought`, `note_font: s.defaultFonts.note` — **chỉ khi có** (bỏ khoá khi undefined để payload cũ/mới đều gọn).
- `claim-inputs.ts:191`: `fontInputs(..., [font, narration_font, thought_font, note_font])`; `:300` (export) thêm `defaults.fonts.thought/note` vào set.
- `MIN_PIPELINE_VERSION` default ở `apps/api/src/env.ts:44` `"0.7.1"` → `"0.8.0"` + dòng comment mốc 0.8.0 (theo lệ các mốc trước). Hệ quả: deploy worker 0.8.0 **trước** API. <!-- Updated: Validation Session 1 - version default nằm trong code -->

## Related Code Files
- Modify: `apps/api/src/routes/series.ts` (`assertKnownFonts` đã lặp mọi value → chỉ cần mở rộng zod), `apps/api/src/jobs/enqueue.ts`, `apps/api/src/jobs/claim-inputs.ts`, `apps/api/src/env.ts`
- Test: `apps/api/test/series.test.ts`, `apps/api/test/claim-fonts.test.ts`, `apps/api/test/claim-inputs.test.ts`, test enqueue/translate settings hiện có (grep `narration_font` trong `apps/api/test`)

## Implementation Steps (TDD)
1. **Tests before**: series chưa có slot mới → translate payload không có `thought_font`/`note_font` (đúng hiện tại; viết assert `not.toHaveProperty`). Xanh trước khi sửa.
2. **Tests new**:
   - PATCH series `default_fonts.thought = "JimLeeThought-Regular"` → lưu, GET trả lại; font id lạ → 400 như slot cũ; giữ khoá `sfx` cũ khi lưu.
   - Enqueue translate → payload có `thought_font`/`note_font` đúng slot.
   - Claim translate: slot `note` = `custom-xxxxxxxx` của user → `inputs.fonts` có URL font đó; font của user khác → không.
   - Claim export: font slot mới nằm trong `inputs.fonts`.
3. Implement.
4. **Regression gate**: `pnpm --filter @mtl/api test && pnpm --filter @mtl/api typecheck`.

## Success Criteria
- [x] Test API mới + cũ xanh.
- [x] Payload sinh ra qua `TranslateSettings.parse` (zod) không lỗi.

## Risk Assessment
- Quên claim-inputs → font tuỳ chỉnh ở slot mới rơi về font mặc định im lặng. Test claim là bắt buộc.
