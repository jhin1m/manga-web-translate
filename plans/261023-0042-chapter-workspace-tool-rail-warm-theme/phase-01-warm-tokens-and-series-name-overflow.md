---
phase: 1
title: "Token màu Giấy ấm + lỗi tên series dài"
status: completed
priority: P1
effort: "2h"
dependencies: []
---

# Phase 1: Token màu "Giấy ấm" + lỗi tên series dài

## Overview
Đổi bảng màu toàn app sang "Giấy ấm" bằng token (không đổi bố cục), gom màu hard-code còn sót về token, sửa lỗi tên
series dài đè cột trạng thái ở home (và kiểm tra cùng lỗi ở trang series / thanh trên màn chương).

## Requirements
- Token theo bảng trong [brief.md](./brief.md#bảng-màu-giấy-ấm-áp-toàn-app-sửa-appswebsrcstylestokenscss).
- Tương phản: chữ ≥ 4.5:1, icon/viền thông tin ≥ 3:1. Đã đo (WCAG, sRGB):

| Cặp | Tỉ lệ | Dùng cho |
|---|---|---|
| `#6b6357` / `#fbf9f4` · `#f3efe6` · `#ebe5d8` | 5.63 · 5.16 · 4.72 | `--c-fg-muted` trên mọi nền — OK |
| trắng / `#c2501b` | 4.71 | chữ nút chính — OK |
| `#c2501b` / `#fbf9f4` · `#f3efe6` | **4.48 · 4.11** | **không đủ cho chữ** → chữ màu nhấn dùng `--c-accent-hover` |
| `#a8430f` / `#fbf9f4` · `#f6e3d6` | ≈5.9 · 4.86 | link, chữ tab/nút đang chọn |
| `#7a7264` / `#fbf9f4` | 4.52 | `--c-fg-subtle` mới (dùng được cả cho chữ) |
| `#a15c00` / `#fdf0dc` · `#b42318` / `#fbe7e4` | 4.62 · 5.53 | nhãn "Cần xem" / "Lỗi" (phase 3) |

- Không dark mode. Ảnh trang, chữ chèn trên ảnh không đổi.

## Architecture
Chỉ CSS token + 1 hằng màu cho Konva (Konva không đọc được CSS variable). Token mới:
`--c-canvas: #e7e1d4` (nền vùng ảnh), `--c-warn-weak: #fdf0dc`, `--c-danger-weak: #fbe7e4` (nền nhãn trạng thái).

## Related Code Files
- Modify: `apps/web/src/styles/tokens.css` — giá trị token, thêm 3 token mới, `--c-fg-subtle: #7a7264`,
  `--c-info`/`--c-focus` = `#c2501b`.
- Modify: `apps/web/src/styles/tokens.css`, `app/app-shell.css`, `features/home/home.css`,
  `features/chapter/chapter-workspace.css`, `features/editor/editor.css` — 22 chỗ `color: var(--c-accent)`: chỗ nào là
  **chữ** trên nền bg/surface → `var(--c-accent-hover)`; icon/viền/nền giữ `--c-accent`.
- Modify: `features/chapter/chapter-workspace.css:255` `#e4e4e2` → `var(--c-canvas)`; `features/editor/editor.css:33`
  `#8a8a85` → `var(--c-canvas)`; `editor.css:41` chữ "Đang tải…" `#f6f6f5` → `var(--c-fg-muted)` (nền giờ sáng).
- Modify: `app/drawer.css:6` scrim `rgb(27 27 26 / 0.32)` → `rgb(42 38 32 / 0.32)` (theo `--c-fg` mới).
- Create: `apps/web/src/features/editor/canvas/colors.ts` — `SELECT_STROKE = "#c2501b"`,
  `SELECT_FILL = "rgba(194, 80, 27, 0.08)"`, comment: phải khớp `--c-accent` ở tokens.css.
- Modify: `features/editor/canvas/OcrSelect.tsx:88,95`, `TextBoxNode.tsx:85`, `TextLayer.tsx:106-107` — thay `#1f4fd1`
  / `rgba(31,79,209,0.08)` bằng hằng trên. `MaskLayer.tsx` (đỏ mask) và `PageSlot.tsx` giữ nguyên.
- Modify: `features/home/home-page.tsx:164` — `<span className="row-name" title={s.title}>`.
- Modify: `features/home/home.css` (`.row-title`, `.row-name`, `.row-sub`, `.row-item .grow`) — cắt "…".
- Modify: `features/chapter/chapter-topbar.tsx` + `chapter-workspace.css` (`.cw-back`) — tên series ở thanh trên cũng
  cắt "…" (`max-width` ~240px) + `title`.
- Kiểm tra (sửa nếu lỗi): `features/series/series-page.tsx` đầu trang (`.series-head`), `.crumbs`, hàng chương
  (`.ch-open`, `.ch-line`).

## Implementation Steps
1. `tokens.css` `:root`: đổi giá trị theo brief; thêm `--c-canvas`, `--c-warn-weak`, `--c-danger-weak`; cập nhật
   comment đầu file ("thang ấm trung tính + 1 nhấn cam đất").
2. `grep -rn "color: var(--c-accent)" apps/web/src --include='*.css'` → duyệt từng chỗ theo quy tắc ở trên.
3. `grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(" apps/web/src --include='*.css'` → thay các chỗ liệt kê; giữ `#fff` chữ
   trên nền nhấn, `mark.hit` (vàng/xanh highlight tìm & thay), nền trắng textarea phủ trên ảnh.
4. Tạo `canvas/colors.ts`, thay hằng màu chọn/khung OCR trong 3 file Konva.
5. Lỗi tên series (home): `.row-title { flex: 0 1 240px; min-width: 0; }`, `.row-name, .row-sub { overflow: hidden;
   text-overflow: ellipsis; white-space: nowrap; }`, `.row-item .grow { min-width: 0; }` (hoặc giá trị nhỏ hơn để không
   tràn), giữ media query 640px. Thêm `title` cho tên.
6. Thanh trên màn chương: `.cw-back` `max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`
   (chữ nằm trong span riêng để icon không bị cắt) + `title={detail?.series.title}`.
7. Trang series: tạo series tên ~120 ký tự không dấu cách + có dấu cách, xem đầu trang/crumbs/hàng chương; sửa cùng kiểu
   nếu tràn.

## Success Criteria
- [ ] `pnpm typecheck && pnpm lint` qua; `pnpm --filter @mtl/web test` qua.
- [ ] `grep -rn "1f4fd1\|#e4e4e2\|#8a8a85" apps/web/src` không còn kết quả.
- [ ] Chạy app (`pnpm dev`), màn 1568×724 và 390px: series tên 120 ký tự ở home hiện "…", hover thấy tên đầy đủ, không
  đè "Ch.1 · Chưa xử lý"; trang series và thanh trên màn chương không tràn.
- [ ] Nút chính, link, tab đang chọn, focus ring đều cam đất; không còn chỗ xanh cũ (soát home, series, glossary, thành
  viên, màn chương, drawer).

## Risk Assessment
- Đổi chữ nhấn sang `--c-accent-hover` lệch nhẹ mockup (mockup dùng `--accent` cho link) — chấp nhận để đạt 4.5:1.
- Màu Konva hard-code lệch token nếu sau này đổi theme → comment trỏ về tokens.css; dark mode ngoài phạm vi.
- E2E không phụ thuộc màu → không ảnh hưởng.
