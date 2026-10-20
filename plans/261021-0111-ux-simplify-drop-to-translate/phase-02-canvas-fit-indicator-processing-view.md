# Phase 2 — Canvas: vừa 1 trang, chỉ báo trang, toolbar không đè, ảnh gốc khi đang dịch

Status: Pending · Branch: `feat/ux-p2-canvas` · Context: [plan.md](./plan.md), [docs/editor.md](../../docs/editor.md)

## Vấn đề
1. Mở chương: fit theo bề ngang, trần 100% (`apps/web/src/features/editor/canvas/ChapterCanvas.tsx:111-121`) → trang 954×1500 trong khung ~1170×580 không thấy trọn 1 trang. Torii mở ở mức trọn trang.
2. "Trang –/5" không bao giờ đổi: effect `setCenter` (`ChapterCanvas.tsx:136-142`) chỉ phụ thuộc `[centerId]`; lần đầu chạy khi `fitted.current` còn false, sau đó `centerId` có thể không đổi → không set. `CanvasStatus` (`panels/CanvasToolbar.tsx:59-70`) đọc `centerPageId`.
3. `.cw-tools` (`apps/web/src/features/chapter/chapter-workspace.css:211`) absolute nằm đè lên ảnh khi cuộn.
4. Page `preparing/prepared/translating` đã có ảnh `clean` → `PageSlot` (`canvas/PageSlot.tsx:27`) hiện ảnh đã xoá chữ (bóng thoại trống) ~1 phút trước khi có bản dịch, trông như lỗi.

## Yêu cầu
- Fit mặc định khi mở chương và khi bật/tắt Chia đôi: scale = min(fit bề ngang nội dung, fit chiều cao 1 page cao nhất trong tầm/page đầu, 1), có lề `EDGE`. Không đổi zoom khi người dùng đã tự zoom.
- Sửa chỉ báo trang: `setCenter` chạy cả khi fit xong (vd đưa `fitted` thành state, hoặc set ngay trong effect fit). Thêm test (vitest) nếu logic tách được thuần.
- Toolbar công cụ không đè ảnh: đặt trong một hàng cố định phía trên vùng canvas (ngoài Stage) hoặc dock bên trái canvas; giữ phím tắt và hành vi hiện có. Không đè nội dung khi cuộn.
- Page chưa `ready` (dùng status page từ `/progress` — xem `page-status.ts` `pageLevel` = `busy`/`todo`): canvas hiện ảnh **gốc** + lớp phủ mờ nhẹ và nhãn "Đang dịch…" (hoặc "Chờ dịch") trên page đó; khi page `ready` mới hiện ảnh clean + chữ. Chế độ "Gốc" giữ nguyên. Không tải thêm ảnh thừa (giữ quy tắc `keepOriginal`).

## File
- Sửa: `apps/web/src/features/editor/canvas/ChapterCanvas.tsx`, `PageSlot.tsx`, `apps/web/src/features/editor/panels/CanvasToolbar.tsx`, `apps/web/src/features/chapter/chapter-workspace.tsx` (vị trí toolbar), `chapter-workspace.css`, có thể `editor/strip-layout.ts` (hàm fit thuần + test).
- Test: `__tests__/strip-layout.test.ts` hoặc test mới cho hàm fit; e2e `editor`, `full-flow`, `typeset-parity` (parity chụp canvas — kiểm zoom không phá).

## Kiểm chứng
- Unit test hàm fit (trang dọc cao, trang ngang, chia đôi).
- e2e liên quan xanh. Nếu e2e dựa vào scale 100% để toạ độ click → cập nhật bằng toạ độ tính từ view, không hard-code.
- Thủ công qua Chrome (localhost:5180, chương 5 series "123"): mở chương thấy trọn trang 1; cuộn → "Trang 2/5"…; toolbar không che ảnh. Muốn xem trạng thái đang dịch: bấm "Dịch lại" một trang (worker local đang chạy).
