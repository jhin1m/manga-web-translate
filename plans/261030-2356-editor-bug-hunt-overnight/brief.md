# Editor bug hunt — chạy xuyên đêm

Status: pending · Branch: `fix/editor-bug-hunt` · Report: `reports/overnight-editor-bug-hunt-report.md`

## Mục tiêu

Editor chương **không bug, chức năng cơ bản dùng tốt, dễ hiểu**. KHÔNG đuổi theo tính năng Torii — Torii chỉ để so cách làm các luồng cơ bản giống nhau. Không thêm tính năng mới; thấy UI thừa / khó hiểu thì ghi đề xuất vào report, không tự xoá tính năng.

## Luồng cơ bản phải chạy đúng (checklist)

1. Mở chương, chuyển trang (rail + cuộn), phóng to/thu nhỏ, kéo canvas.
2. Chọn khối (canvas + bảng chữ), sửa bản dịch, Enter/Esc.
3. Đổi font, cỡ, tự khớp; "Kiểu chữ nâng cao"; "Áp kiểu cho khối cùng loại trong chương".
4. Di chuyển / đổi kích thước khối, thêm khối (công cụ Chữ), xoá khối.
5. Hoàn tác / làm lại (Cmd+Z, Cmd+Shift+Z, Cmd+Y) — kể cả sau khi đổi trang và sau thao tác hàng loạt.
6. Lưu tự động, xung đột phiên bản (2 tab), khoá chương / chế độ chỉ xem.
7. Dịch trang, dịch lại trang/khối, Tìm/Thay, glossary, Export.

Lỗi đã biết (kiểm chứng rồi sửa): "Áp kiểu" ghi thẳng trang khác, không hoàn tác được (Cmd+Z chỉ có ở trang đang mở). Server đã có hoàn tác theo `batch_id` (`apps/api/src/lib/batch-edit.ts`, Tìm/Thay dùng) — cân nhắc đưa "Áp kiểu" qua cơ chế này.

## Quy trình mỗi bug

Tái hiện (trình duyệt hoặc Playwright e2e với fake worker) → chứng minh nguyên nhân → sửa nhỏ nhất → thêm/cập nhật test → `pnpm typecheck && pnpm lint && pnpm test` (+ e2e liên quan) → 1 commit conventional, không nhắc AI. Ghi vào report: mô tả, bước tái hiện, nguyên nhân, commit, trạng thái (fixed / open + lý do).

## Ràng buộc

- Làm trên branch `fix/editor-bug-hunt`. Không push, không merge, không sửa main.
- Chương `01a18dab-be1b-72b5-ad44-450025cfd188` là dữ liệu thật của user: chỉ mở xem, KHÔNG sửa, KHÔNG ghi DB trực tiếp. Cần dữ liệu thử → tạo series "QA đêm" + 1 chương ≤ 5 trang từ `apps/web/e2e/fixtures`, hoặc dùng e2e seed.
- Torii (toriitranslate.com/image): chỉ xem dự án có sẵn. KHÔNG upload, KHÔNG dịch (tốn credit), KHÔNG đổi cài đặt tài khoản / mua gì.
- Không migration phá dữ liệu, không xoá file/thư mục ngoài phạm vi sửa.
- Bị chặn (cần quyết định sản phẩm, cần credential) → ghi "open — cần user" trong report, chuyển bug khác.

## Điều kiện hoàn thành

Đã đi hết 7 luồng trên; mọi bug tìm thấy đều fixed (có test) hoặc open kèm lý do trong report; `pnpm typecheck`, `pnpm lint`, `pnpm test` xanh trên branch; report có mục "Đề xuất đơn giản hoá UI" và "Câu hỏi cho user".
