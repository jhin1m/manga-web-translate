# Phase 2 — Canvas vừa trang, chỉ báo trang, toolbar, ảnh gốc khi đang dịch: report

Ngày: 2026-10-21 · Branch: `feat/ux-p2-canvas` (từ `main` @ cea5c14, chưa merge, chưa push)
Plan: [plan.md](../261021-0111-ux-simplify-drop-to-translate/plan.md) · [phase-02](../261021-0111-ux-simplify-drop-to-translate/phase-02-canvas-fit-indicator-processing-view.md)

## Đã làm
- `editor/strip-layout.ts`: `fitScale(content, page, box)` thuần = min(vừa bề ngang nội dung, vừa chiều cao page, 1), lề `EDGE`. Test: trang dọc, trang ngang, trần 100%, dải webtoon, chia đôi, không có page/min.
- `ChapterCanvas.tsx`:
  - Mở chương: fit theo page của `?page=` (hoặc page đầu), đưa page đó lên trên.
  - `fitted` thành state → effect `setCenter` chạy lại khi fit xong ⇒ "Trang i/N" đúng ngay khi mở và khi cuộn.
  - Khung đổi cỡ khi khung nhìn còn đúng là view do lần fit đặt (so identity `lastFit`) → fit lại. Cần vì bảng dưới/notice đổi chiều cao canvas sau lần đo đầu.
  - Chia đôi: fit lại theo page ở giữa; đã Ctrl/Cmd+cuộn zoom → giữ scale.
  - `strip` memo theo `pages` (trước tính mỗi render; giờ là dep của effect fit, tránh vòng lặp).
  - Page có trong `processing` → không vẽ StaticTextLayer/TextLayer cho page đó.
- `PageSlot.tsx`: prop `processing` (`busy`/`todo`) + `scale`: cột Dịch hiện ảnh gốc + `Rect` trắng 55% + nhãn "Đang dịch…"/"Chờ dịch" cỡ 15px màn hình ở giữa phần page đang thấy. Chế độ Gốc / cột Gốc khi chia đôi không đổi. Layer clean vẫn mount ẩn (như trước) để đổi ngay khi `ready`, không tải thêm ảnh.
- `chapter-workspace.tsx`: map `processing` từ `pageLevel(progress.pages[].status)`, memo theo chữ ký chuỗi (poll không đổi gì → không vẽ lại canvas). `CanvasToolbar` chuyển lên trước canvas.
- `chapter-workspace.css`: `.cw-tools` thành hàng flex cố định trên canvas (viền dưới, `justify-content: safe center`, cuộn ngang khi hẹp); `.cw-canvas` cột dọc.
- `docs/editor.md`: 1 đoạn về fit/toolbar/chỉ báo/page đang dịch.

## Quyết định tự đưa ra
1. **Không fit chiều cao cho dải webtoon**: page cao > 2× rộng (`PAGE_RATIO_MAX`) chỉ vừa bề ngang. Ingest webtoon cắt page 3000–6000px; fit chiều cao → scale ~0.1, chữ không đọc được. Manga (≈1.4–1.6) fit trọn trang.
2. "Page cao nhất trong tầm/page đầu" → dùng page đích (`?page=` hoặc đầu) khi mở; page ở giữa khung khi bật/tắt chia đôi. Đơn giản, đủ cho chương có page cùng cỡ.
3. Page `failed` (level `error`) giữ hiển thị cũ (ảnh sạch nếu có) — phase không yêu cầu.
4. Page chưa xong ẩn cả chữ của page active (đang dịch thì khoá sửa; chữ cũ đè lên ảnh gốc trông sai).
5. Footer "Trang i/N · zoom" giữ absolute góc dưới (pointer-events none, nhỏ) — yêu cầu chỉ nói toolbar.

## Kiểm chứng
- `pnpm typecheck` xanh; `pnpm lint` (biome, 235 file) không lỗi; `pnpm test`: shared 8, web 122, db 3, api 144 — xanh.
- e2e: `editor` (6), `full-flow` (1), `typeset-parity` (1; 82 dòng, lệch tối đa 1px, vượt ngưỡng 0) xanh; thêm `click-budget`, `chapter-tools`, `upload-chapter`, `routes-redirect` (7) xanh.
- Chrome thủ công (5180, chương 5 series "123", cửa sổ 2048×945): mở chương → 27% = (478−80)/1500, trọn trang 1, "Trang 1/5"; cuộn → "Trang 2/5"; toolbar là hàng riêng, không đè ảnh; "Dịch lại trang này" trang 2 → trang 2 hiện ảnh gốc tiếng Anh + lớp mờ + "Đang dịch…", trang 1 không đổi; xong → bản dịch hiện lại. Chia đôi hoạt động.

## Vấn đề còn mở
- Notice "Đã xếp dịch lại trang 2…" chèn trên canvas đẩy canvas xuống (đổi chiều cao) — khi người dùng đã cuộn thì không fit lại (đúng ý), nhưng layout nhảy. Thuộc phạm vi gom trạng thái (Phase 3).
- Cảnh báo React có sẵn "Cannot update a component (`LockBand`) while rendering `ChapterWorkspace`" vẫn xuất hiện trong e2e (đã ghi ở commit cea5c14 cho Phase 3).
- Nhãn "Đang dịch…" vẽ thẳng lên ảnh (không có nền pill); đọc được nhờ lớp mờ, có thể cần nền nếu owner thấy khó nhìn.
- Click rail đưa page lên sát mép trên (margin 0, hành vi cũ `focusPage`), không fit lại scale — giữ nguyên.
