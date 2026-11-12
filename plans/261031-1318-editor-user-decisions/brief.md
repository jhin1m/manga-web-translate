# Editor — làm theo quyết định của user (31/10/2026)

Status: pending · Branch: `feat/editor-user-decisions` (tách từ `fix/editor-bug-hunt`, KHÔNG từ main) · Report: `reports/editor-user-decisions-report.md`

Bối cảnh: đọc mục "Tóm tắt cho sáng mai" + "Câu hỏi cho user" trong
`plans/261030-2356-editor-bug-hunt-overnight/reports/overnight-editor-bug-hunt-report.md`.

## Quyết định của user → việc cần làm

1. **Cmd+Z hoàn tác cả thao tác hàng loạt** (Áp kiểu, Tìm/Thay, Glossary): nếu lượt hàng loạt là thao tác gần nhất thì
   Cmd+Z gọi đúng hoàn tác lượt đó (cùng đường với nút "Hoàn tác", chế độ skip, cùng thông báo); sau đó Cmd+Z tiếp tục lùi
   các sửa trước lượt trên trang đang mở. Cmd+Shift+Z / Cmd+Y làm lại lượt hàng loạt chỉ khi làm được gọn; không thì ghi open.
2. **Căn giữa dọc chữ trong khung (#8)**: tự chọn cách ổn nhất. Bắt buộc editor (canvas) và worker (render/export) khớp nhau;
   chạy gate parity layout hiện có. Không làm hỏng khối đã lưu (cân nhắc tương thích dữ liệu cũ). Ghi lý do chọn vào report.
3. **Cuộn chuột sang trang kế, có hiệu ứng**: cuộn quá cuối trang → trang kế, quá đầu → trang trước. Có ngưỡng để không lật
   nhầm (trackpad quán tính), không xung đột với zoom (Cmd/Ctrl+wheel) và kéo canvas. Hiệu ứng chuyển trang mượt, ngắn;
   tôn trọng `prefers-reduced-motion`.
4. **Hàng đợi job**: tie-break theo thứ tự trang khi `created_at` trùng (trang 1 được prepare trước). Kèm test.
5. **Xoá series "QA đêm"** (`01a18df3-d212-70fa-82a5-b7a51a11ca31`) qua UI/API của app (không SQL tay) — làm CUỐI CÙNG,
   sau khi đã kiểm tay xong (có thể dùng nó để thử 1–3 trước). Đóng mọi tab Chrome agent mở.

## Ràng buộc

- Không push, không merge, không sửa main / `fix/editor-bug-hunt`.
- Chương thật `01a18dab-be1b-72b5-ad44-450025cfd188`: chỉ xem, không sửa.
- Mỗi việc: `/ak:fix` hoặc `/ak:cook` → test → `/ak:code-review` → commit conventional, không nhắc AI.
- Dev: `localhost:5180` chạy từ `pnpm dev:all` ở herdr pane `w1H:p17`; được restart bằng
  `herdr pane send-keys w1H:p17 ctrl+c` rồi `herdr pane run w1H:p17 'pnpm dev:all'` (cần khi đổi worker).
- Cần quyết định sản phẩm mới → ghi "open — cần user", làm việc khác.

## Điều kiện hoàn thành

1–5 xong (có test) hoặc ghi open kèm lý do; `pnpm typecheck`, `pnpm lint`, `pnpm test`, worker pytest, e2e toàn bộ xanh;
report có mục tóm tắt ở đầu và "Câu hỏi cho user" ở cuối; cập nhật docs liên quan (`docs/`) nếu hành vi người dùng đổi.
