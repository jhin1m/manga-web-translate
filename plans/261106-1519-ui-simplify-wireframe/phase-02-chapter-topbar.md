# Phase 2: Thanh trên màn chương

Wireframe: khung "Thanh trên + thanh phụ theo trạng thái".

## File

`features/chapter/chapter-topbar.tsx`, `more-menu.tsx`, `chapter-meta-popover.tsx`, `lang-pair-popover.tsx`, `primary-action.ts` + test, `status.ts` + test, `chapter-workspace.tsx`, `chapter-workspace.css`.

## Việc

1. `EditState`: chỉ render khi đang lưu, lỗi lưu, chưa lưu, hoặc chỉ xem. Lúc bình thường không render. Giữ `role="status"` để trình đọc màn hình vẫn nghe được khi đổi.
2. Chip trạng thái thành nút:
   - Có trang cần xem hoặc lỗi: bấm nhảy tới trang kế cần xem (dùng `needsReview`, vòng lại từ đầu).
   - Trạng thái khác: bấm mở Hoạt động.
   - Thêm mục "Hoạt động" vào menu ⋯ để luôn mở được.
3. Bỏ `ActivityButton` khỏi thanh trên. Chip phải phản ánh cả upload và xuất đang chạy, hiện chỉ theo chương (`activityCount`).
4. Khi chương đang chạy: chỉ một nút Huỷ, bỏ Export bị khoá. Thêm thanh tiến độ 2px dưới thanh trên.
5. Gộp chip "Hàn → Việt" vào popover tên chương. Đổi "Chương 12" thành "Ch.12", "Xem gốc" thành "Gốc" (`aria-label` và tooltip giữ đủ nghĩa).
6. Đổi mọi "Export" trong UI thành "Xuất": `primary-action.ts`, `chapter-topbar.tsx`, `activity-drawer.tsx`, câu ở `export-panel.tsx`.
7. Trạng thái có trang lỗi: nút chính "Chạy lại N trang"; "Xuất" vào menu ⋯ (đã có trong `menu`, chỉ bỏ nút phụ).

## Kiểm tra

- `primary-action.test.ts`, `status.test.ts`; e2e `editor`, `full-flow`, `chapter-tools`, `upload-chapter`, `click-budget`.
- Xem bằng tay đủ 6 trạng thái theo wireframe, tên series dài ở khung hẹp.

## Rủi ro

- Mất dấu "Đã lưu" thường trực: nếu test thực tế thấy lo, thêm dấu ✓ nhỏ, không thêm chữ.
- Nhảy tới trang cần xem khi đang sửa dở: phải qua luồng đổi trang hiện có để lưu trước.
