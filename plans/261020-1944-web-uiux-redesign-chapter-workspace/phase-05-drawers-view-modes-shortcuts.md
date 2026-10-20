---
phase: 5
title: "Drawer Xuất/Hoạt động, chế độ xem, phím tắt"
status: pending
priority: P1
effort: 2.5d
dependencies: [4]
---

# Phase 5: Drawer Xuất/Hoạt động, chế độ xem, phím tắt

## Overview
Đưa Xuất từ Modal sang drawer phải (editor vẫn thấy phía sau) có cảnh báo trước khi xuất; thêm drawer Hoạt động (upload, job chương, export); chế độ xem Gốc / Dịch / Chia đôi + giữ `O` xem gốc; gom phím tắt về 1 bảng thuần có test, bảng tra phím trong UI.

## Requirements
- Drawer chung: phải, rộng 420px, scrim xám đục (không blur — cấm glassmorphism, `docs/design-guidelines.md`), Esc đóng, focus vào drawer khi mở và trả focus khi đóng, `role="dialog"` + `aria-labelledby`.
- **Drawer Xuất**: dùng lại form + danh sách export của `ExportDialog.tsx` (định dạng `png_zip|cbz`, layout `original_slices|pages`, chất lượng, kèm trang chưa dịch; poll 1.5s khi có job; tải qua endpoint 302). Cảnh báo (tính từ cache, không API mới): số trang lỗi, trang chưa xong, block tràn, bản dịch trống (bỏ SFX), page còn "AI có bản mới". Nút "Xem các dòng đó" → bảng lọc "Cần xem", đóng drawer. Có cảnh báo vẫn cho xuất (chỉ thông tin).
- **Drawer Hoạt động**: nút ở topbar "Hoạt động" + số việc đang chạy. Nội dung: Upload (mọi chương, từ `upload-manager`), Job của chương đang mở (`progress.jobs` + số page đang chạy/lỗi kèm `error_class`), Xuất gần đây (tải lại link, huỷ). Ở home chỉ có mục Upload.
- **Chế độ xem**: segmented `[Gốc | Dịch | Chia đôi]` trên topbar. Gốc = ảnh gốc, ẩn chữ; Dịch = ảnh sạch + chữ (mặc định); Chia đôi = 2 cột cùng 1 Stage (trái gốc, phải dịch) → cuộn/zoom đồng bộ tự nhiên; chỉ cột phải nhận thao tác sửa. Giữ `O` = tạm xem Gốc, nhả = về chế độ trước.
- **Phím tắt** (tắt khi focus trong input/textarea/select/contenteditable, trừ các phím có Ctrl/Cmd ghi chú):
  | Phím | Hành động |
  |---|---|
  | V / T / B / E / **R** | Chọn / Khung chữ / Mask / Tẩy / OCR vùng (OCR đổi từ `O` → `R` vì `O` dành cho xem gốc) |
  | giữ O · `\` | Xem gốc tạm · đổi Gốc↔Dịch |
  | A / D, PageUp / PageDown, ← / → | Trang trước / sau (cuộn + kích hoạt) |
  | Alt+↑ / Alt+↓ | Block trước / sau (xuyên trang) |
  | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y | Undo / Redo (page active) |
  | Ctrl/Cmd+S (cả trong ô) | Lưu ngay (`saver.flush`), chặn hộp lưu của trình duyệt |
  | Ctrl/Cmd+F (cả trong ô) | Mở tab Tìm/Thay, focus ô tìm |
  | Enter · Delete · Esc | Sửa chữ box chọn · Xoá box · Bỏ chọn / đóng drawer |
  | ? | Bảng phím tắt |
  | Space giữ + kéo | Kéo canvas |

## Architecture
```
shortcuts.ts (thuần): resolveKey({key, code, mod, shift, alt, repeat, type, inField}, ctx) → Action | null
use-shortcuts.ts: 1 listener keydown/keyup ở ChapterWorkspace → dispatch Action tới session/store
   (thay listener trong EditorPage cũ, đã chuyển tạm vào use-chapter-session ở P3)
chapterStore.viewMode: "original" | "translated" | "split"; holdOriginal: boolean
   effectiveMode = holdOriginal ? "original" : viewMode → ChapterCanvas
   split: contentWidth = 2·maxW + gap; PageSlot vẽ 2 lần (x=0 gốc, x=maxW+gap dịch); pointer ở cột trái = chỉ pan
export-warnings.ts (thuần): exportWarnings(pagesMeta, rows) → {failed, notReady, overflow, empty, aiPending}
```
`editorStore.showOriginal` (`store.ts:30`) giữ cho tương thích, suy ra từ `effectiveMode`.

## Related Code Files
Create:
- `apps/web/src/app/drawer.tsx` (dùng ở màn chương + app shell)
- `apps/web/src/features/chapter/export-drawer.tsx`, `export-warnings.ts` (+ `export-warnings.test.ts`)
- `apps/web/src/features/chapter/activity-drawer.tsx`
- `apps/web/src/features/chapter/view-mode-switch.tsx`
- `apps/web/src/features/editor/shortcuts.ts` (+ `__tests__/shortcuts.test.ts`), `use-shortcuts.ts`
- `apps/web/src/features/chapter/shortcut-help.tsx`
- `apps/web/src/features/chapter/lock-banner.tsx` (chuyển `LockBanner` từ `Modal.tsx:25`)

Modify:
- `apps/web/src/features/chapter/ExportDialog.tsx` → đổi tên/tách thành `ExportPanel` (bỏ `Modal`), giữ `EXPORT_POLL_MS`
- `apps/web/src/features/editor/chapter-store.ts` (`viewMode`, `holdOriginal`)
- `apps/web/src/features/editor/canvas/ChapterCanvas.tsx`, `PageSlot.tsx` (chế độ chia đôi)
- `apps/web/src/features/editor/panels/CanvasToolbar.tsx` (OCR phím R; bỏ nút `\` vì đã có segmented)
- `apps/web/src/features/editor/use-chapter-session.ts` (bỏ listener phím tạm)
- `apps/web/src/features/chapter/chapter-topbar.tsx` (segmented, nút Hoạt động, `?`; primary "Xuất" mở drawer)
- `apps/web/src/app/app-shell.tsx` (slot nút Hoạt động ở home)
- `apps/web/src/features/chapter/FindReplace.tsx`, `apps/web/src/features/glossary/ApplyGlossary.tsx` (import `LockBanner` mới)
- `docs/editor.md` mục Phím tắt (`docs/editor.md:55-59`)
- `apps/web/e2e/chapter-tools.spec.ts` (xuất qua drawer "Xuất chương"), `apps/web/e2e/editor.spec.ts` (gốc/dịch qua segmented + `\`)

Delete:
- `apps/web/src/features/chapter/Modal.tsx` (không còn người dùng sau khi Export thành drawer và LockBanner tách file)

## Implementation Steps
1. `shortcuts.ts` + test (bảng trên; `repeat` của O bỏ qua; `inField` chặn phím đơn).
2. `use-shortcuts.ts`, gỡ listener tạm khỏi session; đổi OCR → R ở toolbar.
3. `viewMode`/`holdOriginal` + segmented + canvas chia đôi.
4. `drawer.tsx`, `ExportPanel` + `export-warnings.ts` + `export-drawer.tsx`; nối primary "Xuất".
5. `activity-drawer.tsx` + nút topbar (home + chương).
6. `lock-banner.tsx`, xoá `Modal.tsx`; docs phím tắt; e2e.

## Success Criteria
- Vitest `shortcuts.test.ts`: mỗi hàng bảng → Action đúng; `inField` + `v` → null; `inField` + Ctrl+S → `save`; keydown O `repeat` → null; keyup O → `holdOriginalEnd`; `r` → tool `ocr`.
- Vitest `export-warnings.test.ts`: 1 page failed + 2 box tràn + 1 region trống (SFX trống không đếm) → `{failed:1, overflow:2, empty:1}`.
- E2E `chapter-tools.spec.ts`: bấm "Xuất" → drawer `role=dialog` tên "Xuất chương" → Xuất → worker giả → link "Tải xuống" → 302 tới presigned GET có tên file; Esc đóng drawer, focus về nút Xuất.
- E2E `editor.spec.ts`: segmented "Gốc"/"Dịch"/"Chia đôi" đổi `aria-pressed`, không lỗi console khi đổi 4 lần; giữ `O` (keydown, chờ 150ms) → "Gốc" pressed, keyup → "Dịch" pressed; chia đôi + sửa ô Dịch vẫn lưu.
- E2E case mới: drawer Hoạt động khi đang upload (home) liệt kê chương đang upload với tiến độ; trong chương đang `processing` liệt kê job `chapter.translate`.
- `rg -n "Modal\b" apps/web/src` = 0; `pnpm typecheck && pnpm lint && pnpm test` + e2e xanh.

## Risk Assessment
| Rủi ro | L×I | Giảm thiểu |
|---|---|---|
| Chia đôi gấp đôi bitmap (gốc + sạch) | M×H | Trần mount 4 page áp theo cặp (= 2 page khi chia đôi); đo bộ nhớ |
| Đổi OCR `O` → `R` làm người quen phím cũ bấm nhầm | L×L | Bảng `?` + tooltip; docs |
| Ctrl+S / Ctrl+F chặn hành vi trình duyệt ngoài màn chương | L×M | Listener chỉ gắn trong `ChapterWorkspace` |
| Drawer che mất cảnh báo khoá/lưu | L×M | Thông báo khoá/lỗi lưu nằm topbar, không trong drawer |
Rollback: revert PR (Export về Modal; phím cũ).
