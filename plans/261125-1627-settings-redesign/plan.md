# Redesign trang Cài đặt (tham khảo Koharu)

Status: done (chưa commit) · 25/11/2026

## Outcome
Trang Cài đặt dễ dùng hơn: mỗi mục có tiêu đề + mô tả, các tuỳ chọn nằm trong thẻ dạng hàng (nhãn + giải thích bên trái, ô chọn bên phải), tự lưu khi đổi. Không còn hai chỗ quản lý font gây rối.

## Quyết định
- Gộp "Model tác vụ" vào "Pipeline", chia theo từng bước xử lý trang: Phát hiện chữ → Đọc chữ (OCR engine theo ngôn ngữ + model AI đọc chữ) → Xoá chữ → Dịch (model AI) → Hiệu đính (model AI). Lý do: chọn "AI" ở OCR engine và chọn model OCR ở mục khác là hai nửa của cùng một quyết định.
- Bỏ mục `tasks`; link cũ `?section=tasks` rơi về Pipeline (validSection có sẵn).
- Tự lưu (không nút Lưu) cho Pipeline + model AI: select lưu ngay khi đổi, ô số lưu khi rời ô nếu hợp lệ. Trạng thái "Đang lưu / Đã lưu / lỗi" ở đầu mục. "Về mặc định" hỏi lại tại chỗ.
- Model AI: `<optgroup>` theo nhà cung cấp; chưa có nhà cung cấp thì hiện link sang mục Nhà cung cấp.
- Nhà cung cấp: danh sách thẻ thay bảng; form sửa mở ngay trong thẻ của nhà cung cấp đó.
- Font: local mode ẩn "Font hệ thống" khỏi Cài đặt; trang `/fonts` hiện font hệ thống cũ (nếu còn) để xoá được. Bản nhiều người đổi tên thành "Font dùng chung".
- Hạn mức / Người dùng: chỉ dùng chung khung tiêu đề mới, giữ logic.

## Không làm
- Không đổi API, schema, worker.
- Không thêm tuỳ chọn pipeline mới.

## Acceptance
- typecheck, vitest, biome sạch; e2e admin-settings, pipeline-settings, fonts cập nhật theo UI mới.
- Kiểm bằng trình duyệt: Pipeline tự lưu và giữ sau reload; gán model Dịch; local mode không còn hai trang font.

## Đợt 2 (25/11 17:00): gộp trang font + font trong máy
- Một trang `/fonts` (menu "Font"): Font có sẵn (34 font gói sẵn, xem trước) · Font đã thêm (riêng + dùng chung gắn nhãn) · Thêm font (từ máy hoặc file). Bỏ mục Cài đặt › Font dùng chung; admin bản nhiều người tích "Cho mọi người dùng" khi thêm.
- Font trong máy: Local Font Access API (`queryLocalFonts`, Chrome/Edge, cần bấm cho phép). Chọn font → lấy file → upload như font riêng. Lý do không dùng thẳng font máy: worker vẽ ảnh xuất bằng đúng file font (hợp đồng layout), nên font phải lên server. TTC / >10MB báo không hỗ trợ.
- Giới hạn font riêng: local 200, nhiều người 20 (`userFontLimit` ở @mtl/shared).
- Editor / cài đặt series: nhóm "Font hệ thống" đổi tên "Font dùng chung" (tránh lẫn với font cài trong máy).
