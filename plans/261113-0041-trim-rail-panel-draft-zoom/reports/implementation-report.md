# Implementation report: cắt mép ở rail trái + zoom ảnh gốc ở màn nháp (13/11/2026)

Nhánh `feat/trim-rail-panel` (từ `main`). Phase 1 + 3 xong; phase 2 (review độc lập) chưa chạy.

## Files
Mới (`apps/web/src/features/chapter/`): `trim-panel.tsx`, `use-source-trim.ts`, `source-trim-model.ts` (+ test),
`source-zoom.ts` (+ test).
Sửa: `tool-rail-model.ts` (+ test: `PanelId`/`RailTarget` thêm `trim`, rời panel cắt khi chọn công cụ khác),
`tool-rail.tsx` (nút Cắt mép, `showTrim`), `tool-icons.tsx` (Scissors/Minus/Plus), `canvas-controls.tsx` (`ZoomPercentButton`,
`ZoomControls` dùng chung với pager editor), `source-viewer.tsx` (controlled: edges/natural từ workspace, zoom, bỏ thanh
Xong/Huỷ), `source-rail.tsx` (bỏ 2 mục menu + 2 prop), `chapter-workspace.tsx` (bỏ `trimId`/`startTrim`/`finishTrim`; panel Cắt mép,
`pickSource` tự lưu), `chapter-workspace.css`, `docs/editor.md`, `plan.md`.
E2e: `trim-source`, `trim-learn-band`, `trim-auto-drop` (dùng rail + panel).

## Quyết định
- Nút rail ẩn khi đã có page (`showTrim={sourceMode}`); đang cắt trang (không sửa được) = hiện nhưng tắt + lý do.
- Lưu / Enter = lưu và đóng panel (như "Xong" cũ, toast Hoàn tác / Luôn cắt giữ nguyên); Huỷ / Esc / × = bỏ nháp; "Bỏ cắt" = ghi null + đóng.
- Đổi ảnh: `pickSource` gọi `commit()` (chỉ ghi khi nháp khác số đã lưu), panel ở lại. Lưu lạc quan nên không cần "nháp ghost" cũ.
- Phím trong chế độ cắt giữ quy tắc cũ (handler document pha bubble, bỏ qua input/menu/dialog); panel tự bắt Enter/Esc cho ô số và
  `stopPropagation` để không lưu / huỷ hai lần.
- Canvas hiện không có nút − / + trước đó (chỉ nút %); thêm − / + cho viewer nháp, nút % dùng chung component với editor.
  Editor chưa có phím zoom nên không thêm phím. Zoom 0,1×–4× cùng hệ số wheel với editor; zoom neo theo con trỏ bằng
  toạ độ ảnh thật (`anchorShift`), reset về Vừa khung khi đổi ảnh (state gắn id ảnh).
- Thanh cắt đặt theo % chiều cao ảnh nên đúng px ảnh thật ở mọi zoom (e2e kiểm chứng sau nút + Ctrl+cuộn + kéo).

## Test
- typecheck sạch, `pnpm lint` sạch; `pnpm test`: shared 124, web 532 (thêm tests cho rail model, trim model, zoom), db 8, api 727 (+1 skipped).
- E2e xanh: trim-source (thêm: gõ số + kẹp, auto-save khi đổi ảnh, Enter trong ô, nút zoom + Ctrl+cuộn + kéo thanh sau zoom,
  về Vừa khung khi đổi ảnh, menu chuột phải không còn mục cắt), trim-learn-band, trim-auto-drop (nhãn "Credit · tự cắt"
  trong panel), upload-chapter (không đụng mục cắt, vẫn xanh), full-flow, chapter-topbar, click-budget, rail-text-export, routes: 29/29.
- `block-panel.spec.ts:317` (lỗi sẵn trên main) không chạy.

## Ảnh chụp
`plans/261113-0041-trim-rail-panel-draft-zoom/reports/shot-1-rail-icon.png` (rail, trước khi mở panel),
`shot-2-panel.png` (panel + 2 thanh), `shot-3-zoomed.png` (156%). Chụp bằng Playwright trên server e2e (không phải :5180).

## Ghi chú
- Toast "Đã cắt mép…" nằm đè mép trên canvas, che thanh trên lúc vừa lưu (hành vi sẵn có); e2e kéo thanh dưới sau khi lưu.
- `getByLabel("Dưới")` khớp cả slider "Mép dưới": test phải khoanh vùng trong panel.
