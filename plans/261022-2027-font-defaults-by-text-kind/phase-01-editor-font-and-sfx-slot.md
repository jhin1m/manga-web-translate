---
phase: 1
title: "Editor font Thoại + ẩn SFX"
status: completed
priority: P1
effort: "1.5h"
dependencies: []
---

# Phase 1: Editor font Thoại + ẩn SFX

## Overview
Chỉ đụng web. Box tạo tay trong editor dùng font Thoại của series; form + sidebar series bỏ slot SFX, làm rõ slot Dẫn truyện.

## Requirements
- Functional:
  - Box mới (vẽ khung `ChapterCanvas.tsx:222`, OCR vùng `OcrSelect.tsx:57`) dùng `series.default_fonts.dialogue`.
  - Fallback: font series không có trong `kit.manifest.fonts` hoặc chưa chọn → `kit.manifest.defaults[0]` → `"Bangers-Regular"`.
  - Form series: chỉ 2 ô **Thoại**, **Dẫn truyện**. Option rỗng của Dẫn truyện ghi "Giống font thoại"; hint "Áp dụng cho chữ ngoài bóng."
  - Sidebar series: thay dòng "Font SFX" bằng "Font dẫn truyện" (rỗng → "Giống font thoại").
- Non-functional: không đổi API/DB; giá trị `sfx` đã lưu được giữ nguyên khi PATCH (form không gửi xoá nó).

## Architecture
- `chapter-workspace.tsx` đã có `ws`, `seriesId`. Dùng `useQuery({ queryKey: seriesKeys.detail(ws, seriesId), queryFn: () => fetchSeries(ws, seriesId) })` — cùng key với `series-page.tsx:39`, nên lưu form (đã invalidate/remove key này) tự cập nhật editor.
- Hàm thuần trong `apps/web/src/features/editor/fonts.ts`:
  ```ts
  /** Font cho box tạo tay: font thoại của series nếu manifest còn font đó, không thì default manifest. */
  export function dialogueFont(manifest: FontManifest, seriesFont: string | undefined): string
  ```
- Kiểm tra `default_fonts` khi PATCH: form đang spread `f.default_fonts` → khoá `sfx` cũ vẫn được gửi lại nguyên; giữ nguyên hành vi đó (không lọc bỏ).

## Related Code Files
- Modify: `apps/web/src/features/chapter/chapter-workspace.tsx` (dòng ~416 `defaultFont`)
- Modify: `apps/web/src/features/editor/fonts.ts` (thêm `dialogueFont`)
- Modify: `apps/web/src/features/series/series-settings-form.tsx` (`FONT_SLOTS` dòng 34, label option rỗng, hint)
- Modify: `apps/web/src/features/series/series-sidebar.tsx` (dòng 30–32)
- Create/Modify: test vitest cho `dialogueFont` cạnh test editor hiện có (`apps/web/src/features/editor/__tests__/`)

## Implementation Steps
1. Thêm `dialogueFont` vào `editor/fonts.ts` + test (series font hợp lệ / không có trong manifest / undefined).
2. `chapter-workspace.tsx`: query series detail; `defaultFont = kit ? dialogueFont(kit.manifest, series?.default_fonts.dialogue) : "Bangers-Regular"`. Trong lúc query series chưa về: dùng default manifest (không chặn editor).
3. `series-settings-form.tsx`: bỏ `sfx` khỏi `FONT_SLOTS`; option rỗng theo slot (`dialogue` → "Mặc định hệ thống", `narration` → "Giống font thoại"); thêm hint dưới ô Dẫn truyện.
4. `series-sidebar.tsx`: "Font dẫn truyện".
5. `pnpm --filter web typecheck && pnpm --filter web test` (dùng đúng tên package trong `apps/web/package.json`); grep test/snapshot nào còn nhắc "SFX" của form.

## Success Criteria
- [x] Series chọn font Thoại = BeVietnamPro → vẽ box tay ra BeVietnamPro.
- [x] Series chưa chọn → Bangers (như cũ).
- [x] Form không còn ô SFX; lưu form không làm mất `default_fonts.sfx` cũ trong DB.
- [x] typecheck + vitest web xanh.

## Risk Assessment
- Thêm 1 request series khi mở chương: nhỏ, thường đã có cache từ trang series. Chấp nhận.
- Đổi font series khi đang mở editor: chỉ ảnh hưởng box tạo **sau** đó; box cũ giữ font — đúng kỳ vọng.
- Rollback: revert commit web, không có dữ liệu bị đổi.
