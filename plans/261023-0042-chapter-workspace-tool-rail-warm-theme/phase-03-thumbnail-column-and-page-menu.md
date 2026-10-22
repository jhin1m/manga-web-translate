---
phase: 3
title: "Cột thumbnail 112px + menu chuột phải trang/ảnh"
status: pending
priority: P1
effort: "4h"
dependencies: [2]
---

# Phase 3: Cột thumbnail phải (112px) + menu chuột phải

## Overview
Rail trang 196px (trái) thành cột thumbnail 112px bên phải canvas: chỉ ảnh + số trang, trạng thái = viền + nhãn ngắn
khi có vấn đề. Ẩn / khôi phục trang và xoá / khôi phục ảnh gốc chuyển sang menu chuột phải (và nút trong panel Chọn) —
bỏ icon xoá thường trực mỗi hàng. Giữ đủ tính năng rail hiện có (bộ lọc cần xem, ảnh gốc trước Bước 1, credit, "Có thể
là credit", tự cuộn tới trang đang mở).

## Requirements
- Cột: đầu 36px "N trang" (ảnh gốc: "N ảnh · đã bỏ k"); có trang cần xem → thêm nút bật/tắt "Cần xem k"
  (`aria-pressed`, lọc danh sách như bộ lọc cũ). Thân cuộn dọc, item căn giữa, cách 12px.
- Item = `button` thumbnail 72×100 (`img` `object-fit: cover; object-position: top`, tải lười) + số trang góc dưới
  phải; dưới thumbnail chỉ hiện nhãn khi có vấn đề:

| Trường hợp (ưu tiên trên → dưới) | Viền | Nhãn |
|---|---|---|
| Trang ẩn (`skipped`) | 1px dashed `--c-line-strong`, mờ .45 | "Đã ẩn" (muted) |
| Lỗi (`failed`, job hỏng) | 2px `--c-danger` | "Lỗi" (nền `--c-danger-weak`) |
| Chờ AI tự thử lại (`waitingOnProvider`) | 2px `--c-warn` | "Chờ AI" (nền `--c-warn-weak`) |
| Cần xem (`needsReview`: AI có bản mới, tràn khung) | 2px `--c-warn` | "Cần xem" (nền `--c-warn-weak`) |
| Bình thường (Chờ dịch / Đang xử lý / Xong) | 1px `--c-line-strong` | không có |

  Trang đang mở: `outline: 2px solid var(--c-accent); outline-offset: 3px` + `aria-current="page"`.
- Tên truy cập luôn đủ trạng thái (kể cả trang bình thường): `aria-label="Trang 3 · Xong"`,
  `"Trang 2 · Cần xem: tràn khung"`, `"Trang 7 · Lỗi"`; `title` = cờ chi tiết (AI có bản mới · tràn khung · cắt ở trần
  chiều cao · chờ AI thử lại) hoặc câu lỗi `describeJobError`.
- Trang ẩn nằm đúng vị trí theo `ord` (gộp `pages` + `hiddenPages`), không còn bộ lọc "Đã xoá". Bấm trang ẩn → mở menu
  tại thumbnail (canvas không mở được trang ẩn).
- Menu chuột phải (cả bàn phím: Shift+F10 / phím Menu trên thumbnail đang focus):
  - Trang hiện: "Ẩn trang n" (không dịch, không xuất) — disabled + title khi không giữ khoá / đang chạy / còn 1 trang.
  - Trang ẩn: "Khôi phục trang n".
  - Ảnh gốc (trước Bước 1, còn sửa được bộ ảnh): "Xoá ảnh n" / "Khôi phục ảnh n".
- Panel Chọn (chưa chọn khối) có nút "Ẩn trang này"; khi chương chưa có page, panel Chọn hiện thông tin ảnh gốc đang
  xem ("Ảnh n" + nhãn) + "Xoá ảnh này" / "Khôi phục ảnh này" + đếm "N ảnh · đã bỏ k".
- Đổi chữ "Xoá trang" → "Ẩn trang" ở UI (toast "Đã ẩn trang n (không dịch, không xuất)." + Hoàn tác + "Luôn bỏ ở series
  này"). Ảnh gốc giữ "Xoá ảnh". API không đổi.

## Architecture
- Hàm thuần trong `page-status.ts`:
  ```ts
  export type ThumbMark = { tone: "hidden" | "danger" | "warn"; label: "Đã ẩn" | "Lỗi" | "Chờ AI" | "Cần xem" } | null;
  export function thumbMark(p: ProgressPage, overflow: boolean): ThumbMark; // theo bảng ưu tiên trên
  export function thumbAria(p: ProgressPage, overflow: boolean): string;  // "Trang n · <nhãn / PAGE_LEVEL label>[: cờ]"
  ```
  (`ProgressPage` nằm ở `api.ts`; nếu import vòng thì nhận kiểu tối thiểu `{ ord, status, skipped, ai_update_available,
  cut_flag, job }`.)
- `context-menu.tsx` dùng chung: `{ at: { x: number; y: number }, items: { label; danger?; disabled?; title?; run() }[],
  onClose }` → `div role="menu"` vị trí fixed (kẹp trong viewport), `button role="menuitem"`, focus mục đầu, ↑/↓ di
  chuyển, Esc / bấm ngoài / blur → đóng và trả focus về thumbnail.
- Gộp danh sách: `[...pages, ...hidden].sort((a, b) => a.ord - b.ord)` (memo theo 2 mảng).

## Related Code Files
- Modify: `apps/web/src/features/chapter/page-rail.tsx` — viết lại thành cột thumbnail (giữ tên file/component
  `PageRail` để ít đổi import; cập nhật comment đầu file). Props thêm `onMenu?`; bỏ `Filter` 3 trạng thái.
- Modify: `apps/web/src/features/chapter/source-rail.tsx` — cùng kiểu thumbnail + nhãn `sourceLabel`, menu Xoá/Khôi
  phục ảnh; bỏ icon thường trực.
- Create: `apps/web/src/features/chapter/context-menu.tsx`.
- Modify: `apps/web/src/features/chapter/page-status.ts` (+ `page-status.test.ts`) — `thumbMark`, `thumbAria`.
- Modify: `apps/web/src/features/chapter/inspector.tsx` — nút "Ẩn trang này" ở phần thông tin trang (props
  `onHidePage`, `hideDisabled?: string`); view ảnh gốc khi `sourceMode` (props `source?: { item, total, skipped,
  editable, onSkip }`).
- Modify: `apps/web/src/features/chapter/chapter-workspace.tsx` — đặt `PageRail`/`SourceRail` vào vùng `thumbs`; chữ toast
  "Đã ẩn trang…"; truyền handler cho panel; trong source mode panel Chọn vẫn hiện (rail công cụ: Chữ/Mask/Tẩy/OCR
  disabled).
- Modify: `apps/web/src/features/chapter/chapter-workspace.css` — cột 112px (`grid-template-columns: 64px auto
  minmax(0,1fr) 112px`), `.cw-thumbs*`, `.cw-ctx-menu`; xoá `.cw-rail*` không dùng nữa.
- Modify: `apps/web/src/features/home/row-icons.tsx` — chỉ nếu `TrashIcon/RestoreIcon` không còn ai dùng ở rail (home vẫn
  dùng → giữ).

## Implementation Steps
1. `thumbMark` / `thumbAria` + test (ẩn > lỗi > chờ AI > cần xem > bình thường; aria có nhãn mức cho trang bình thường).
2. `context-menu.tsx` (+ đóng khi cuộn cột thumbnail).
3. Viết lại `PageRail`: đầu cột + toggle "Cần xem k"; item `div.cw-thumb-item[data-page]` > `button.cw-thumb`
   (`data-tone`, `aria-current`, `onContextMenu` → `preventDefault` + mở menu tại `clientX/Y`; trang ẩn `onClick` mở
   menu tại góc thumbnail) + `span.cw-thumb-mark`. Giữ `scrollIntoView` khi active đổi. Giữ `memo`.
4. `SourceRail` tương tự (`data-source`, "Ảnh n" trong aria-label, nhãn Đang tải / Tải lỗi / Chưa tải / Đã xoá /
   Credit · tự bỏ / Có thể là credit).
5. Panel Chọn: "Ẩn trang này" (cùng `skipPage` của workspace, đã tự chuyển sang trang kế trước khi ẩn); view ảnh gốc
   cho source mode.
6. CSS: kích thước 72×100, nhãn 11px, số trang `rgba(27,27,26,.82)`/trắng 10.5px như mockup (nằm trên ảnh nên không đổi
   theo theme), vùng bấm cả thumbnail.
7. Soát tính năng giữ nguyên: credit tự bỏ mờ + Khôi phục (menu), "Có thể là credit", ảnh đang tải hiện Blob local, ←/→
   ở source mode.

## Success Criteria
- [ ] `page-status.test.ts`, `source-rail-model.test.ts` qua; `pnpm typecheck && pnpm lint` qua.
- [ ] Thủ công: thumbnail đúng kích thước mockup (72×100, cột 112px; ở 1568×724 thấy ~5–6 trang — xem "Câu hỏi mở"
  trong plan.md); trang tràn
  khung viền cam + "Cần xem"; trang lỗi viền đỏ + "Lỗi"; ẩn trang qua chuột phải → mờ "Đã ẩn" tại chỗ + toast Hoàn tác
  / Luôn bỏ ở series này; khôi phục qua menu; Shift+F10 mở menu bằng bàn phím; trước Bước 1 xoá/khôi phục ảnh qua menu
  và nút trong panel; đọc màn hình đọc "Trang n · trạng thái".
- [ ] Không còn icon xoá trên từng hàng.

## Risk Assessment
- Mất khả năng nhìn nhanh "Chờ dịch / Xong" từng trang (chủ ý theo brief) — chip thanh trên + aria-label + title bù.
- Menu chuột phải khó khám phá → thêm nút trong panel Chọn (brief cho phép) + title thumbnail "Chuột phải: ẩn trang".
- Trang ẩn trong danh sách chung có thể bị ←/→ nhảy vào: `go(pages[idx±1])` vẫn dùng `pages` (chỉ trang hiện) → giữ.
