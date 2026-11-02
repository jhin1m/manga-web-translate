---
phase: 4
title: "Web: slot series + editor Loại chữ"
status: completed
priority: P2
effort: "4h"
dependencies: [1, 3]
---

# Phase 4: Web — slot series + editor "Loại chữ"

## Overview
Form/sidebar series có 2 ô font mới; Properties có select "Loại chữ" đổi style region + font box trong 1 bước undo.

## Requirements
- `series-settings-form.tsx:46` thêm slot: `{ slot: "thought", label: "Suy nghĩ", empty: "Như thoại/dẫn truyện", hint: "Chữ trong ngoặc, độc thoại, nói thầm." }`, `{ slot: "note", label: "Ghi chú", empty: "Như thoại/dẫn truyện", hint: "Chữ viết tay, chú thích nhỏ." }`. `FontSlot` type (`series/api.ts:16`) mở rộng.
- `series-sidebar.tsx`: hiện 2 dòng mới chỉ khi đã chọn (giữ sidebar gọn — xem memory UX tối giản).
- `editor/fonts.ts`: hàm thuần `fontForStyle(manifest, defaultFonts, style, kind, isKnown)` — cùng quy tắc worker (`fonts[style]` nếu biết, else narration cho text_free (narration trống → dialogue), else `dialogueFont`). Không chạm `dialogueFont`.
- `editor/actions.ts`: action `setTextStyle(boxId, style, font, layout)` → set `region.style` (xoá khoá khi `normal`) + `box.font_family = font` + `relayout` (auto_fit). Không region → no-op.
- `Properties.tsx`: select "Loại chữ" dưới ô Font. Hiện khi box có `region_id` tồn tại **và** series đã chọn ít nhất 1 slot `thought`/`note`; option chỉ gồm "Thường" + loại có slot (region đang mang style không có slot → vẫn liệt kê để không mất giá trị). `readOnly` thì disabled. "Thường" = `normal` cho cả 2 kind. <!-- Updated: Validation Session 1 - ẩn khi series chưa chọn slot -->
- `chapter-workspace.tsx:831`: truyền `default_fonts` + kind xuống chỗ Properties cần (theo cách đang truyền fonts).

## Related Code Files
- Modify: `apps/web/src/features/series/{series-settings-form.tsx,series-sidebar.tsx,api.ts}`, `apps/web/src/features/editor/{fonts.ts,actions.ts,panels/Properties.tsx}`, `apps/web/src/features/chapter/chapter-workspace.tsx`
- Test: `apps/web/src/features/editor/__tests__/fonts.test.ts`, `__tests__/actions.test.ts`, `__tests__/rebase.test.ts` (style qua rebase/autosave), test form series nếu có

## Implementation Steps (TDD)
1. **Tests before**: `dialogueFont` + `insertOcrRegion` hành vi hiện tại có test → chạy xanh, giữ nguyên.
2. **Tests new**:
   - `fontForStyle`: bảng 3 style × 2 kind × slot có/trống/không biết → khớp bảng quy tắc worker (copy bảng từ test phase 2 để giữ parity logic).
   - `setTextStyle`: đổi sang thought → region.style + font đổi; về normal → khoá style bị xoá; undo 1 bước khôi phục cả 2; box không region → state không đổi.
   - rebase/merge: style region đi qua rebase như các trường region khác.
   - Properties: series không slot → không render select; chỉ slot `thought` → option Thường + Suy nghĩ.
3. Implement fonts → actions → Properties → form/sidebar.
4. **Regression gate**: `pnpm --filter @mtl/web test && pnpm --filter @mtl/web typecheck && pnpm lint`.
5. Chạy app (skill `run`): series chọn font Suy nghĩ, mở chương, đổi Loại chữ 1 box → font đổi, reload còn, Cmd+Z quay lại. Chụp màn hình.

## Success Criteria
- [x] Test web xanh; kiểm tay ở bước 5 đạt.
- [x] Form series lưu/đọc 2 slot mới; series cũ hiện "Như thoại/dẫn truyện".

## Risk Assessment
- Lệch quy tắc fallback web ↔ worker → box tạo lại trong editor khác font auto-typeset. Giảm: cùng bảng test ở 2 phía.
- Properties đã đông: chỉ 1 select, không thêm text giải thích.
