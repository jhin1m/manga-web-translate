---
phase: 2
title: "Khung bố cục: rail công cụ + panel ngữ cảnh"
status: pending
priority: P1
effort: "5h"
dependencies: [1]
---

# Phase 2: Khung bố cục — rail công cụ 64px + panel ngữ cảnh

## Overview
Thay bố cục 4 vùng (rail trang | canvas + hàng công cụ | inspector | bảng dưới) bằng: rail công cụ trái 64px → panel
ngữ cảnh 288px (560px cho Bản dịch, Tìm) → canvas → (cột thumbnail ở phase 3; phase này giữ rail trang cũ ở cột phải
tạm thời). Panel tạm chứa **nội dung hiện có** (Inspector, bảng văn bản, Tìm/Thay, Áp glossary); phase 4 mới làm lại
nội dung. Hoàn tác / Làm lại dời lên thanh trên (hàng công cụ trên canvas bị bỏ).

## Requirements
- Rail: Chọn (V) · Chữ (T) · Mask (B) · Tẩy (E) · OCR (R) · ── · Bản dịch · Tìm. Icon 20px + nhãn 11px, nút 52×52,
  `aria-label` + `title` có phím tắt ("Chọn (V)", "Chữ (T)", "Mask xoá chữ (B)", "Tẩy nét mask (E)", "OCR vùng (R)",
  "Bản dịch cả chương", "Tìm / Thay · Glossary (Ctrl+F)").
- Bấm icon công cụ: chưa mở panel công cụ đó → đặt tool + mở panel; đang mở đúng nó → thu panel (tool giữ nguyên).
  Bấm Bản dịch / Tìm: mở/thu panel đó, **không đổi tool**. Nút công cụ đang chọn nhưng panel thu/đang ở panel khác:
  chữ màu nhấn (không nền) — như mockup.
- Phím V/T/B/E/R: đổi tool; panel đang mở ở chế độ công cụ thì nội dung đổi theo; panel đang thu thì **giữ thu**.
- Ctrl/Cmd+F: mở panel Tìm, đoạn "Tìm / Thay", focus `#fr-find` (như cũ, chỉ khi `canTools`).
- Chọn 1 khối trên canvas khi panel đang thu → mở panel công cụ (Chọn). Panel đang là Bản dịch/Tìm → giữ nguyên (bảng
  cuộn tới dòng như hiện tại).
- Drawer Xuất "Xem các khối này" → lọc "Chỉ khối cần xem" + mở panel Bản dịch.
- Disabled như hàng công cụ cũ: chỉ xem (`readOnly`) → mọi công cụ trừ Chọn; chương chưa có page (ảnh gốc) → Chữ / Mask
  / Tẩy / OCR; `!canTools` → Tìm (title "Dùng được khi chương dịch xong").
- Panel thu/mở + panel đang mở nhớ theo trình duyệt (`localStorage` `mtl.layout` = `{ panel }`; khoá cũ
  `bottomOpen/bottomH` bỏ qua; đọc/ghi bọc try/catch). Mặc định: panel công cụ mở.
- Nút thu panel trong đầu panel (icon ×, `aria-label="Thu panel"`).
- Hoàn tác / Làm lại: icon trên thanh trên (`aria-label="Hoàn tác (Ctrl+Z)"`, `"Làm lại (Ctrl+Shift+Z)"`), disabled
  như cũ (hết lịch sử hoặc chỉ xem).

## Architecture
- State panel ở React state của `Workspace` (không cần store chung): `panel: PanelId | null`,
  `PanelId = "tool" | "table" | "find"`. Logic bấm rail là hàm thuần để test:
  ```ts
  // features/chapter/tool-rail-model.ts
  export type RailTarget = Tool | "table" | "find";
  export function railClick(cur: { panel: PanelId | null; tool: Tool }, t: RailTarget):
    { panel: PanelId | null; tool: Tool } {
    if (t === "table" || t === "find") return { panel: cur.panel === t ? null : t, tool: cur.tool };
    if (cur.panel === "tool" && cur.tool === t) return { panel: null, tool: t };
    return { panel: "tool", tool: t };
  }
  export const PANEL_TITLE = { select: "Chọn & sửa", text: "Thêm chữ", brush: "Mask xoá chữ", eraser: "Tẩy nét mask",
    ocr: "OCR vùng", table: "Bản dịch cả chương", find: "Tìm / Thay · Glossary" };
  ```
- `layout-prefs.ts`: `readPanel(): PanelId | null` / `writePanel(p)` (thay `readLayout` trong bottom-panel).
- Lưới CSS `.cw`:
  ```css
  grid-template-columns: 64px auto minmax(0, 1fr) 196px; /* 196px → 112px ở phase 3 */
  grid-template-rows: 52px auto minmax(0, 1fr);
  grid-template-areas: "top top top top" "band band band band" "tools panel main thumbs";
  ```
  Panel không render khi thu → cột `auto` về 0, canvas rộng ra; `ChapterCanvas` đã có ResizeObserver + "vừa lại khi
  người dùng chưa động vào khung nhìn" nên không cần thêm logic.
- Panel giữ trạng thái khi đổi panel: Bản dịch / Tìm mount lần đầu khi mở, sau đó chỉ `hidden` (giữ kết quả xem trước
  Tìm/Thay) — cùng cơ chế `seen` của `BottomPanel` hiện tại.
- Focus theo yêu cầu (Ctrl+F): giữ kiểu `{ seq, focus }` của `TabRequest`, effect trong `ContextPanel` focus selector
  sau khi panel hiện.

## Related Code Files
- Create: `apps/web/src/features/chapter/tool-rail-model.ts` (+ `tool-rail-model.test.ts`).
- Create: `apps/web/src/features/chapter/layout-prefs.ts`.
- Create: `apps/web/src/features/chapter/tool-rail.tsx` — `<nav className="cw-toolrail" aria-label="Công cụ">`.
- Create: `apps/web/src/features/chapter/tool-icons.tsx` — SVG (path lấy từ mockup, `stroke-width 1.75`,
  `aria-hidden`): select, text, mask, eraser, ocr, table, find, undo, redo, close, eye, more, chevrons, copy, pencil,
  retranslate, trash. Dùng chung cho phase 3–5.
- Create: `apps/web/src/features/chapter/context-panel.tsx` — `<aside className="cw-panel" data-wide aria-label={title}>`
  đầu 44px (h2 + nút thu) + thân cuộn.
- Modify: `apps/web/src/features/chapter/chapter-workspace.tsx` — state panel, `railClick`, nối Ctrl+F / drawer Xuất /
  selection subscribe (mở panel khi đang thu); thay `<aside className="ed-side cw-side">` + `<BottomPanel>` bằng
  `<ToolRail>` + `<ContextPanel>`; bỏ `<CanvasToolbar />`.
- Modify: `apps/web/src/features/chapter/inspector.tsx` — bỏ tablist "Khối chữ / Xoá chữ" (rail thay); tool brush/eraser
  vẫn hiện `MaskPanel`. Tool text/ocr tạm hiện như Chọn (phase 4 làm view riêng).
- Modify: `apps/web/src/features/chapter/chapter-topbar.tsx` — thêm `UndoRedo` (2 `icon-btn`) sau spacer, đọc
  `editorStore` như `CanvasToolbar`.
- Modify: `apps/web/src/features/editor/panels/CanvasToolbar.tsx` — xoá `CanvasToolbar` + `TOOLS`; giữ `CanvasStatus`
  (phase 5 thay).
- Delete: `apps/web/src/features/chapter/bottom-panel.tsx` (logic `seen` + focus chuyển sang `context-panel.tsx`).
- Modify: `apps/web/src/features/chapter/chapter-workspace.css` — lưới mới, `.cw-toolrail`, `.cw-tool`, `.cw-panel`
  (288 / 560), bỏ `.cw-bottom*`, `.cw-resize`, `.cw-tools`, `.cw-side-tabs`, `.cw-side` cũ.
- Modify: comment đầu `chapter-workspace.tsx` (bố cục mới).

## Implementation Steps
1. Viết `tool-rail-model.ts` + test (5 case: mở tool, bấm lại thu, đổi tool khi panel mở, table/find toggle không đổi
   tool, bấm tool khi đang ở table → panel tool).
2. `layout-prefs.ts` (đọc/ghi `mtl.layout`), test nhỏ với localStorage giả hoặc bỏ test nếu chỉ là try/catch.
3. `tool-icons.tsx`, `tool-rail.tsx` (props: `panel`, `tool`, `disabled: Partial<Record<RailTarget, string>>` = title
   lý do, `onClick(t)`).
4. `context-panel.tsx` (props: `title`, `wide`, `onClose`, `focusRequest`, `children`).
5. Workspace: render `ToolRail` + `ContextPanel` theo `panel`:
   - `tool` → `<Inspector …>` (như cũ).
   - `table` → `<TableFilters>` + `<TextTable>` (bảng cao hết panel).
   - `find` → segmented "Tìm / Thay" | "Glossary" (`fieldset.cw-seg`, `aria-pressed`) + `FindReplacePanel` /
     `ApplyGlossaryPanel` (giữ mount sau lần đầu).
   - Xoá `openTab`/`TabRequest` dùng cho bảng dưới; Ctrl+F → `setPanel("find")`, `findTab="find"`, focus `#fr-find`.
   - Subscribe `editorStore` selection (đã có): selection mới khác null && panel null → `setPanel("tool")`.
6. Thanh trên: `UndoRedo` trước nhóm icon Hoạt động.
7. CSS lưới + rail (`.cw-tool[aria-pressed=true]` nền `--c-accent-weak`, chữ `--c-accent-hover`; `[data-current]` chữ
   `--c-accent-hover`), panel (`border-right`, nền `--c-bg`, đầu panel `border-bottom --c-surface-2`), vùng bấm ≥ 32px.
8. Ghi prefs khi `panel` đổi.

## Success Criteria
- [ ] `pnpm --filter @mtl/web test` (gồm `tool-rail-model.test.ts`), `pnpm typecheck`, `pnpm lint` qua.
- [ ] Thủ công (`pnpm dev`, 1568×724 và 1920×1080): mỗi icon mở đúng panel; bấm lại thu, canvas rộng ra và ảnh vừa lại
  (khi chưa zoom tay); V/T/B/E/R đổi nội dung panel khi mở, giữ thu khi thu; Ctrl+F mở Tìm + focus ô tìm; Hoàn tác/Làm
  lại trên thanh trên chạy; drawer Xuất → "Xem các khối này" mở Bản dịch đã lọc; tải lại trang nhớ panel.
- [ ] Không còn hàng công cụ trên canvas, bảng dưới, tablist "Khối chữ / Xoá chữ".
- E2E: các spec dùng tab "Bản dịch"/"Tìm / Thay"/tabpanel và "Bảng thuộc tính" sẽ đỏ tới phase 6 (ghi rõ trong
  commit message nếu cần, không nới test).

## Risk Assessment
- `TextTable` ảo hoá dựa chiều cao khung: panel phải là flex column, bảng `flex:1; min-height:0` — kiểm tra cuộn + giữ
  focus ô đang gõ.
- `FindReplacePanel` / `ApplyGlossaryPanel` mất kết quả xem trước nếu unmount khi đổi panel → giữ mount + `hidden`.
- Phím tắt khi focus nằm trong panel (ô nhập) vẫn tắt phím đơn như cũ (`inField`) — không đổi.
