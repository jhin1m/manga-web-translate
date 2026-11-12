# Phase 1: Home, Series, Cài đặt

Wireframe: khung "Home · Mới", "Series · Mới", "Cài đặt series · Mới".

## File

`features/home/home-page.tsx`, `home.css`, `new-chapter-confirm-row.tsx`, `features/upload/drop-zone.tsx`, `features/series/series-page.tsx`, `series-settings-form.tsx`, `skip-images-section.tsx`, `comic-kind-picker.tsx`, `app/app-shell.tsx`, `features/chapter/activity-drawer.tsx` (`ShellActivity`). Xoá `features/series/series-sidebar.tsx`.

## Việc

1. `DropZone` thành dải 56px: icon + "Thả ảnh / ZIP" + "chọn file". Home và Series dùng chung. Khi 0 series giữ vùng lớn.
2. Bỏ câu "tự tạo chương và dịch ngay" ở cả hai trang. Trước khi bỏ, thả thử 1 ZIP để xác nhận chương dừng ở chờ bấm "Dịch chương".
3. Home: bỏ tiêu đề "Series · N"; ô tìm + "+ Series" thành một hàng; hàng series một dòng (tên, chấm + trạng thái, số chương, Sửa, Xoá), bỏ "x đã xuất".
4. Form tạo series và dòng "Vừa thả" mỗi cái một dòng. `ComicKindPicker` thành `select`, bỏ mô tả từng loại.
5. Series: bỏ breadcrumb (nút ‹), bỏ cột phải, đầu trang có "Glossary · N" + icon Cài đặt. Xoá sidebar, kiểm tra query glossary còn dùng ở `SeriesModalLinks`.
6. Hàng chương một dòng: số, chấm + trạng thái, thời gian, Xoá. Bỏ icon Sửa. Thanh tiến độ 2px chỉ hiện khi đang chạy. Giữ thả lại file vào hàng "tải dở".
7. Cài đặt: hiện Tên, Dịch từ, Sang, Định dạng, Font thoại. Thu gọn kèm tóm tắt: Giọng văn, Kính ngữ, Xưng hô, Font khác, Chữ bỏ qua, Ảnh tự bỏ.
8. Nút Lưu dính đáy modal. "Ảnh tự bỏ" tự lưu riêng nên không phụ thuộc nút Lưu, cần ghi rõ bằng cách đặt tách khỏi phần form hoặc ⓘ.
9. Hint dưới trường chuyển vào ⓘ (tooltip phải mở được bằng phím). "Xoá series" thành link đỏ, bấm mới hiện ô gõ tên.
10. Nút Hoạt động trên shell chỉ hiện khi có việc đang chạy. Glossary chung, Font, Cài đặt vẫn ở menu tài khoản.

## Kiểm tra

- Typecheck, lint, test, e2e: `series-manage`, `upload-chapter`, `glossary-language-pair`, `click-budget`.
- Xem bằng tay: 0 series, 1 series, tên series dài, chương tải dở.

## Rủi ro

- Lỗi validate (xưng hô thiếu trường) nằm trong nhóm đang thu gọn: tự mở nhóm có lỗi và focus trường lỗi.
- Hoàn nguyên: revert commit, không có thay đổi dữ liệu.
