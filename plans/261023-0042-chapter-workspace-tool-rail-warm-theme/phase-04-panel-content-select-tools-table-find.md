---
phase: 4
title: "Nội dung panel: Chọn, công cụ, Bản dịch, Tìm"
status: pending
priority: P1
effort: "5h"
dependencies: [2, 3]
---

# Phase 4: Chuyển nội dung inspector / bảng dưới / tìm-thay vào panel

## Overview
Làm lại nội dung panel theo mockup: mỗi công cụ chỉ hiện thứ nó cần. Inspector cũ tách thành panel Chọn (có khối /
chưa có khối / ảnh gốc) và các view thiết lập công cụ; bảng văn bản cả chương vừa panel 560px; Tìm gộp "Tìm / Thay" +
"Glossary" bằng segmented. Không bỏ tính năng nào của inspector cũ.

## Requirements
**Chọn + có khối** (thứ tự trên → dưới):
1. Dòng phụ "Trang n · Khối i / tổng · <Loại>" (`KIND_LABEL`: Thoại / Chữ nền / SFX / Tự thêm — chỉ đọc, xem Câu hỏi mở).
2. `AiUpdatePanel` + `ConflictList` (khi có — giữ ở đầu panel Chọn cho cả 2 trạng thái).
3. Gốc (OCR, chỉ đọc, nền `--c-surface`).
4. Bản dịch: `TextField id="cw-translation"` (cùng nguồn với bảng, `setRowTranslation`).
5. Cảnh báo tràn khung (`overflowText`, nền `--c-warn-weak`, chữ `--c-warn`).
6. Font (select) · Cỡ chữ (số, tắt khi "Tự khớp") · checkbox "Tự khớp cỡ chữ vào khung".
7. `<details>` "Kiểu chữ nâng cao" (thu gọn mặc định): giãn dòng, lề, căn lề, màu chữ, màu viền, viền ngoài, "Ẩn khi
   xuất", "Áp kiểu này cho khối <loại> trong chương" (giữ bước xác nhận cũ).
8. Hàng nút: "Dịch lại khối" (= luồng "OCR lại" hiện có: nhận dạng + dịch lại vùng, disabled khi khối không có vùng OCR,
   title giải thích) · "Xoá khối" (`btn-danger`, `deleteBox`). Link phụ "Dịch lại trang này".
9. Vùng chưa có khung chữ: thay mục 6–8 bằng "Vùng này chưa có khung chữ — dùng công cụ Chữ (T) để thêm." + "Dịch lại
   khối".

**Chọn + chưa có khối**: "Trang n · <trạng thái>" (`status` chấm màu), danh sách cờ hiện có (AI có bản mới, tràn khung
k khối, cắt ở trần chiều cao, lỗi + "Chi tiết kỹ thuật" thu gọn, chờ AI thử lại), gợi ý "Bấm một khối chữ trên ảnh để
sửa.", nút "Dịch lại trang này" · "Ẩn trang này" (phase 3), "Bỏ chỉnh sửa tay, dùng lại bản AI" (giữ xác nhận).

**Chọn khi chương chưa có page**: view ảnh gốc (phase 3).

**Chữ (T)**: gợi ý "Kéo một khung trên ảnh để tạo khối chữ mới." + "Font khối mới: <font thoại của series>" (chỉ đọc).
**Mask (B) / Tẩy (E)**: `MaskPanel` + segmented "Tô (B)" | "Tẩy nét (E)" (đổi tool brush/eraser), cỡ bút, "Xoá chữ
vùng đã tô", "Bỏ nét" — Tẩy = tẩy nét mask như hiện tại.
**OCR (R)**: gợi ý "Kéo khung quanh chữ AI bỏ sót. Chữ đọc được thành khối mới và được dịch luôn." + "Ngôn ngữ gốc:
<ngôn ngữ series>" (chỉ đọc, đổi ở Cài đặt series) + "Đang OCR n vùng…" khi chờ.

**Bản dịch (560px)**: hàng lọc ("Chỉ khối cần xem", "Chỉ trang đang mở") + bảng ảo hoá cột
`28px 32px minmax(0,1fr) minmax(0,1.2fr) 84px` (#, Tr., Gốc, Dịch sửa tại chỗ, Tình trạng); cột "Loại" bỏ khỏi lưới
(loại vẫn ở `title` của dòng và ở panel Chọn); gợi ý "Bấm một dòng để mở trang đó và chọn khối trên ảnh. Enter: dòng
sau". Giữ phím Enter / Shift+Enter / Alt+Enter / Esc trong ô và đồng bộ 2 chiều với canvas.

**Tìm (560px)**: segmented "Tìm / Thay" | "Glossary" (`fieldset.cw-seg`, `aria-pressed`) → `FindReplacePanel` /
`ApplyGlossaryPanel` nguyên tính năng (xem trước, áp dụng, hoàn tác, tới khối, chọn cụm cũ). Bảng kết quả cuộn ngang
trong panel nếu quá rộng, không tràn ra canvas.

## Architecture
- Đổi tên `inspector.tsx` → `select-panel.tsx` (`git mv`), component `SelectPanel` gồm `BlockView`, `PageView`,
  `SourceView`. View công cụ ở `tool-panels.tsx` (`TextToolView`, `OcrToolView`); `MaskPanel` thêm segmented.
- Tách `Properties.tsx` thành 2 export dùng chung logic `style(field, patch)`:
  `BasicStyle` (font, cỡ, tự khớp) và `AdvancedStyle` (phần còn lại). Bỏ nút "Xoá khung" ở đây (đã có "Xoá khối" ở hàng
  nút + thanh nổi phase 5).
- Workspace chọn view theo `panel` + `tool`:
  ```tsx
  panel === "tool" && (tool === "select" ? <SelectPanel …/> : tool === "text" ? <TextToolView …/>
    : tool === "ocr" ? <OcrToolView …/> : <MaskPanel …/>)
  ```

## Related Code Files
- Rename/Modify: `apps/web/src/features/chapter/inspector.tsx` → `select-panel.tsx`.
- Create: `apps/web/src/features/chapter/tool-panels.tsx`.
- Modify: `apps/web/src/features/editor/panels/Properties.tsx` — `BasicStyle`, `AdvancedStyle`.
- Modify: `apps/web/src/features/editor/panels/MaskPanel.tsx` — segmented Tô/Tẩy nét, bỏ `<h3>` (đầu panel đã có tiêu đề).
- Modify: `apps/web/src/features/chapter/text-table/text-table.tsx` — bỏ ô "Loại" khỏi lưới (giữ trong `title`),
  chữ gợi ý trong `TableFilters`.
- Modify: `apps/web/src/features/chapter/chapter-workspace.tsx` — chọn view; truyền `series.data` (font thoại, ngôn ngữ
  gốc) + `ocr.pending`.
- Modify: `apps/web/src/features/chapter/chapter-workspace.css` — `.cw-panel` field/label (12px muted), `.cw-adv`
  (details), lưới bảng trong panel, `.cw-tool-list { overflow-x: auto }`.
- Modify: `apps/web/src/features/editor/editor.css` — `.ed-props` trong panel 288px (lưới 2 cột cho số/màu).
- Đọc lại: `features/series/lang-labels.ts` (nhãn ngôn ngữ), `features/editor/fonts.ts` (`dialogueFont`).

## Implementation Steps
1. Tách `Properties` → `BasicStyle` / `AdvancedStyle`; cập nhật chỗ import.
2. `select-panel.tsx`: dời JSX từ inspector theo thứ tự yêu cầu; giữ mọi handler (`onReocr`, `onApplyKind`,
   `onRetranslatePage`, `resetToAI`, confirm states); "Dịch lại khối" gọi `onReocr(row)`.
3. `tool-panels.tsx` + segmented trong `MaskPanel`.
4. Bảng văn bản: CSS lưới mới trong panel; kiểm tra ảo hoá + focus khi panel 560px; `ROW_H` giữ 40 (chữ dài cắt 2
   dòng, đầy đủ trong `title`).
5. Tìm: segmented + giữ mount 2 panel; kiểm tra bảng xem trước của FindReplace / bảng glossary vừa 560px.
6. Soát danh sách tính năng inspector cũ → mới (ghi vào commit message nếu có chỗ đổi vị trí): OCR lại ⇒ Dịch lại khối;
   Áp kiểu cùng loại ⇒ trong "Kiểu chữ nâng cao"; Xoá khung ⇒ Xoá khối; còn lại giữ chỗ trong panel Chọn.

## Success Criteria
- [ ] `pnpm typecheck && pnpm lint && pnpm --filter @mtl/web test` qua (rows/text-utils/export-warnings không đổi).
- [ ] Thủ công trên chương đã dịch: sửa bản dịch ở panel ↔ bảng ↔ canvas đồng bộ; đổi font/cỡ có undo; mở "Kiểu chữ
  nâng cao" đổi màu/viền/căn lề; Áp kiểu cùng loại (xác nhận); Dịch lại khối (OCR + dịch vùng); Xoá khối; Bỏ chỉnh sửa
  tay; AI có bản mới áp từng vùng; mask tô → xoá chữ vùng đã tô; OCR vùng kéo khung; Tìm/Thay xem trước → áp → hoàn tác
  → tới khối; Áp glossary chọn cụm cũ → áp → hoàn tác.
- [ ] Panel Chọn khi chưa chọn khối không còn "trống": có trạng thái trang + 2 nút.

## Risk Assessment
- Dời JSX dễ rơi tính năng ít dùng (Chi tiết kỹ thuật, cut_flag, ai_update) → bước 6 là checklist bắt buộc.
- `TextField key={row.key}` phải giữ để không lẫn nội dung khi đổi khối.
- Panel 288px chật cho `AdvancedStyle` (3 ô màu/số 1 hàng) → lưới 2 cột, input số rộng 100%.
