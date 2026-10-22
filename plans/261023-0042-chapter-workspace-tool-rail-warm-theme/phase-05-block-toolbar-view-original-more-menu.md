---
phase: 5
title: "Thanh nổi cạnh khối, Xem gốc, menu ⋯, Vừa khung / 100%"
status: pending
priority: P1
effort: "5h"
dependencies: [4]
---

# Phase 5: Thanh nổi cạnh khối + "Xem gốc" + menu "⋯" + điều khiển canvas

## Overview
Hoàn tất bố cục theo mockup: thanh thao tác nổi cạnh khối đang chọn, thanh trên gọn lại (1 nút "Xem gốc" thay
`[Gốc | Dịch | Chia đôi]`, menu "⋯" chứa Chia đôi / Dịch lại cả chương / Chạy lại trang lỗi / Phím tắt), điều hướng trang
nổi góc dưới trái và "Vừa khung" / "100%" góc dưới phải canvas.

## Requirements
- **Thanh nổi** (`role="toolbar"`, `aria-label="Thao tác khối"`): Sửa chữ · Dịch lại khối · Nhân đôi khối · | · Xoá khối
  (đỏ). Icon-btn 32px, `aria-label` + `title` (Xoá: "Xoá khối (Delete)"). Hiện khi: có box chọn, tool = Chọn, không đang
  gõ trên canvas (`editing`), không chỉ xem, page active không đang xử lý. Đặt trên khối (cách 8px); khối sát mép trên
  khung nhìn → đặt dưới; kẹp trong bề ngang canvas. Đi theo khối khi kéo/zoom/cuộn (tính từ `view` + box).
  - Sửa chữ → mở panel Chọn + focus `#cw-translation` (Enter / double-click vẫn sửa trực tiếp trên canvas như cũ).
  - Dịch lại khối → cùng handler panel (OCR + dịch vùng); disabled khi khối không có vùng OCR hoặc đang OCR.
  - Nhân đôi → box mới id mới, lệch +16px x/y, cùng chữ/kiểu, `region_id: null` (thành dòng "Tự thêm"), được chọn ngay,
    1 bước undo.
  - Xoá → `deleteBox` (như phím Delete).
- **Xem gốc**: nút có chữ + icon mắt, `aria-pressed` = đang hiện Gốc (`effectiveMode === "original"`, kể cả lúc giữ
  `O`), title "Xem ảnh gốc (giữ O · \ đổi Gốc/Dịch)". Bấm: Gốc ↔ Dịch (đang Chia đôi → sang Gốc). Phím `O` giữ và `\` giữ
  nguyên.
- **Menu ⋯** (`icon-btn aria-label="Thêm thao tác"`, `aria-haspopup="menu"`): "Chia đôi gốc / dịch"
  (`menuitemcheckbox`, `aria-checked`; bật = `split`, tắt = về Dịch) · các mục `primary.menu` trừ `cancel`/`export`
  ("Dịch lại cả chương", "Chạy lại trang lỗi" — `retry` trước đây không hiện ở thanh trên, nay có) · "Phím tắt (?)".
  Đóng khi chọn mục, Esc, bấm ngoài; Esc trả focus về nút ⋯.
- Thanh trên còn: ‹ series · Chương N · chip · chỉ báo khoá/lưu · spacer · Hoàn tác · Làm lại · | · Xem gốc · Hoạt
  động (+ số) · ⋯ · [Huỷ xử lý khi đang chạy] · [Xuất phụ khi có] · [nút chính]. Bỏ "Dịch lại ▾" và nút `?`.
- **Canvas**: góc dưới trái "‹ Trang n / M ›" (nút `aria-label` "Trang trước (←)"/"Trang sau (→)", nền `--c-bg`, viền
  `--c-line`); góc dưới phải nhóm "Vừa khung" · "100%" (`aria-pressed`) + mức zoom hiện tại (mono). Vừa khung = khung
  nhìn mở trang (`pageStartView`, bỏ cờ zoomed); 100% = scale 1, đầu trang sát mép trên, đặt cờ zoomed (đổi trang giữ
  100%). Mặc định mở chương = Vừa khung (như hiện tại). Source mode giữ `SourceViewer` hiện có.

## Architecture
- `actions.ts`:
  ```ts
  /** `src` = box thường lấy từ `editorStore.getState().doc` (không phải draft) → clone an toàn. */
  export const duplicateBox = (src: TextBox, newId: string, offset = 16) =>
    addBox({ ...structuredClone(src), id: newId, region_id: null, x: src.x + offset, y: src.y + offset });
  ```
  Id mới theo kiểu đang dùng: `` `tb-${crypto.randomUUID().slice(0, 8)}` ``. `rebase.ts` đã có op `add` cho
  `text_boxes` nên lưu/rebase không cần thêm gì.
- `page-layout.ts` hàm thuần vị trí thanh nổi:
  ```ts
  export function blockBarPos(box: { x: number; y: number; w: number; h: number }, v: View, frame: Size, bar: Size,
    gap = 8): { left: number; top: number; below: boolean }
  ```
- `chapter-store.ts`: `fitView(scale?: number)` — page active + `box` → `editorStore.setView(pageStartView(…, scale))`,
  `setZoomed(scale !== undefined)`. Dùng chung cho 2 nút.
- `BlockToolbar.tsx` render trong khung `ChapterCanvas` (cùng lớp với textarea sửa chữ), nhận callback qua props
  `ChapterCanvas`: `onEditBlock()`, `onRetranslateBlock(boxId)`, `canRetranslate(boxId)`.
- `more-menu.tsx` dùng mẫu `details.cw-menu` sẵn có + đóng khi Esc/bấm ngoài (hoặc dùng lại `context-menu.tsx` của phase 3
  neo vào nút — chọn 1, không làm 2 kiểu menu).

## Related Code Files
- Modify: `apps/web/src/features/editor/actions.ts` (+ `__tests__/actions.test.ts`) — `duplicateBox`.
- Modify: `apps/web/src/features/editor/page-layout.ts` (+ `__tests__/page-layout.test.ts`) — `blockBarPos`.
- Modify: `apps/web/src/features/editor/chapter-store.ts` (+ `__tests__/chapter-store.test.ts`) — `fitView`.
- Create: `apps/web/src/features/editor/canvas/BlockToolbar.tsx`.
- Modify: `apps/web/src/features/editor/canvas/ChapterCanvas.tsx` — render `BlockToolbar`, props callback.
- Modify: `apps/web/src/features/editor/panels/CanvasToolbar.tsx` → đổi thành `canvas-controls.tsx` (pager + zoom) hoặc
  sửa `CanvasStatus` tại chỗ; xoá file nếu rỗng.
- Create: `apps/web/src/features/chapter/more-menu.tsx`.
- Delete: `apps/web/src/features/chapter/view-mode-switch.tsx` (thay bằng `OriginalToggle` trong topbar hoặc file nhỏ
  riêng).
- Modify: `apps/web/src/features/chapter/chapter-topbar.tsx` — bố cục mới, bỏ "Dịch lại ▾", `?`, `ViewModeSwitch`.
- Modify: `apps/web/src/features/chapter/chapter-workspace.tsx` — handler thanh nổi (Sửa chữ → panel + focus; Dịch lại
  khối → `onReocr` theo box), truyền `onHelp` vào menu.
- Modify: `apps/web/src/features/editor/shortcuts.ts` — chỉ `SHORTCUT_HELP` chữ ("\\": "Đổi Gốc ↔ Dịch (nút Xem gốc)",
  Esc: "Bỏ chọn khối"); bảng phím giữ nguyên, `shortcuts.test.ts` không đổi.
- Modify: `apps/web/src/features/chapter/chapter-workspace.css` — `.cw-blockbar`, `.cw-pager`, `.cw-zoom`, menu.

## Implementation Steps
1. `duplicateBox` + test (id mới, lệch 16, region null, không trùng id, undo 1 bước qua `store.apply`).
2. `blockBarPos` + test (đặt trên; sát mép trên → dưới; kẹp trái/phải; zoom 2× / 0.5×).
3. `fitView` + test (không có page active → no-op; scale 1 đặt zoomed; fit bỏ zoomed).
4. `BlockToolbar` (đo kích thước thanh bằng ref, mặc định 4 nút ≈ 150×38); ẩn khi đang kéo vẽ khung (`gesture`) nếu bị
   nhấp nháy.
5. Topbar: `OriginalToggle`, `MoreMenu`, sắp lại thứ tự; xoá `view-mode-switch.tsx`.
6. Canvas controls: pager trái + zoom phải (absolute trong `.cw-canvas`, không đè thông báo `.cw-toasts`).
7. Soát phím tắt bằng tay theo bảng trong `docs/editor.md` (V/T/B/E/R, giữ O, `\`, A/D, ←/→, Alt+↑/↓, Ctrl+Z/Y/S/F,
   Enter, Delete, Esc, ?, Space kéo, Ctrl+cuộn).

## Success Criteria
- [ ] `pnpm --filter @mtl/web test` (actions, page-layout, chapter-store, shortcuts) + `pnpm typecheck && pnpm lint` qua.
- [ ] Thủ công: chọn khối → thanh nổi trên khối (khối đầu trang → dưới khối), theo khối khi zoom/cuộn; 4 nút chạy, Nhân
  đôi thêm 1 dòng "Tự thêm" trong bảng, Ctrl+Z bỏ được; Xem gốc bật/tắt, giữ O nút sáng; ⋯ → Chia đôi (dấu check), Dịch
  lại cả chương, Phím tắt mở drawer; Vừa khung/100% đúng, đổi trang giữ 100%; mọi phím tắt cũ chạy.
- [ ] Mọi tính năng cũ mở được ≤ 1 cú bấm từ màn chương (bảng đối chiếu trong `plan.md`).

## Risk Assessment
- Thanh nổi đè đúng chỗ người dùng định kéo khung → đặt cách khối 8px, ẩn khi tool ≠ Chọn hoặc đang gõ.
- Chia đôi: khối nằm ở cột Dịch (x ≥ 0) nên công thức vị trí không đổi; kiểm tra lại.
- `details` menu không tự đóng khi bấm ngoài → thêm listener `pointerdown` document khi mở.
