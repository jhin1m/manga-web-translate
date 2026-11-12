# Phase 1 report: Home, Series, Cài đặt series

## Việc theo mục
1. DropZone: dải 56px (icon + "Thả ảnh / ZIP" + "chọn file"), dùng chung Home/Series; 0 series giữ vùng lớn. Giữ thêm size "md" vì màn chương (phase sau) còn dùng.
2. Bỏ câu "tự tạo chương và dịch ngay". Đã xác nhận trước khi bỏ: code `useDropToTranslate` chỉ tạo chương + upload (không gọi translate/process), e2e click-budget + full-flow khẳng định chương dừng "Nháp" tới khi bấm "Dịch chương". Sửa luôn comment sai ở drop-to-translate.ts và new-chapter-confirm-row.tsx.
3. Home: bỏ tiêu đề "Series · N", ô tìm + "+ Series" một hàng, hàng series một dòng (tên, chấm + trạng thái, "N ch", Sửa, Xoá); bỏ "đã xuất" và ô bìa.
4. Form tạo series và "Vừa thả" mỗi cái một dòng; ComicKindPicker thành select, bỏ mô tả loại (xoá comic-kind-picker.css, bỏ `hint` trong COMIC_KIND_LABELS).
5. Series: một cột, ‹ về home thay breadcrumb, "Glossary · N" + icon Cài đặt; xoá series-sidebar.tsx (query glossary vẫn dùng ở SeriesHead và form cài đặt).
6. Hàng chương một dòng (số, chấm + trạng thái, thời gian, Xoá); bỏ icon Sửa; vạch 2px chỉ khi tone "busy". Thả lại file vào hàng "Upload dở" vẫn chạy (có e2e mới).
7. Cài đặt: luôn hiện Tên, Dịch từ, Sang, Định dạng, Font thoại; thu gọn kèm tóm tắt: Giọng văn, Kính ngữ, Xưng hô, Font khác, Chữ bỏ qua, Ảnh tự bỏ.
8. Lưu nằm ở footer modal (nút submit gắn form qua `form=`). "Ảnh tự bỏ" nằm ngoài form, tóm tắt ghi "tự lưu, không cần bấm Lưu" + dòng giải thích trong nhóm.
9. Hint chuyển sang ⓘ (`app/info-tip.tsx`: hiện khi hover/focus bàn phím/bấm, `aria-describedby`). "Xoá series" là link đỏ ở footer, bấm mới hiện ô gõ tên.
10. Nút Hoạt động trên shell chỉ hiện khi có chương đang tải ảnh (giữ nếu drawer đang mở). Glossary chung / Font / Cài đặt vẫn ở menu tài khoản.

## Quyết định tự chọn
- Lỗi xưng hô thiếu trường: bỏ việc vô hiệu nút Lưu, kiểm khi bấm Lưu → mở nhóm Xưng hô, focus ô trống đầu tiên, tóm tắt đỏ "Thiếu thông tin". Lỗi "Chữ bỏ qua" vẫn chặn Lưu (giữ assertion cũ) và tự mở nhóm.
- Bỏ `key` theo settings_rev trên dialog (remount sẽ đóng hết nhóm sau khi lưu); thay bằng `setF(toForm(s))` khi lưu xong.
- Nhãn đổi theo wireframe: Dịch từ / Sang / Định dạng / Font thoại / nút "Lưu" / "+ Series". e2e đổi selector tương ứng.
- Nút ⓘ có aria-label "Giải thích X"; Esc đóng modal (Drawer bắt Esc ở capture) nên không có Esc riêng cho tooltip, tooltip ẩn khi blur/rời chuột.
- Khung xoá series: ô xác nhận ở footer, nút "Xoá vĩnh viễn".

## Mất tính năng / thay đổi cần biết (Concerns)
- Thêm nhanh từ glossary + 5 từ mới nhất ở cột phải màn series biến mất theo kế hoạch (bỏ cột phải); thêm từ vẫn làm được trong modal Glossary. e2e upload-chapter chuyển sang modal.
- Hoạt động ẩn khi không có upload đang chạy: nút "Thử lại" upload lỗi ở drawer không còn lối vào từ Home/Series khi không còn upload nào "uploading"; vẫn còn "Tải tiếp" ở hàng "Upload dở" và nút Thử lại ở màn chương.
- Hàng chương không còn dòng chi tiết (a.detail) và thanh tiến độ cố định; detail nằm trong `title` của link.

## Kiểm
- Test mới: unit `settings-summary.test.ts` (4); e2e 4 mới: nhóm thu gọn + mở/focus khi thiếu trường xưng hô (không gọi PATCH), ⓘ bằng phím + Ảnh tự bỏ + xoá series bấm mới hiện, Home 1280 (dải 56px, hàng ≤56px, Hoạt động ẩn, menu tài khoản), thả lại file vào hàng "Upload dở".
- Gate: typecheck xanh, lint xanh (0 cảnh báo), unit web 381 / api 435 / shared 60 / db 8, e2e 60/60 (56 cũ + 4 mới, 3.4 phút).
- e2e sửa theo tên mới: helpers (home sẵn sàng = region "Series"), signup, admin-settings, fonts, glossary-language-pair, routes, upload-chapter, series-manage. click-budget không đổi, budget giữ nguyên.

## Đã xem bằng ảnh (Playwright tạm 1280x800, đã xoá spec)
0 series; nhiều series + tên rất dài; form + series; dòng "Vừa thả" (file lỗi); series tên dài; hàng "Upload dở" + "Đang cắt trang" (vạch 2px); modal cài đặt thu gọn; modal với Xưng hô mở + tooltip ⓘ; ô xoá series; Home/Series ở 390px.
Chưa xem: hàng "Vừa thả" khi chọn "+ Series mới…" và nhóm ảnh tự bỏ có ảnh thật (chỉ kiểm bằng e2e, không bằng ảnh). Ở 390px hàng chương/series xuống dòng được nhưng hơi chật (không phải mục tiêu của phase).

## Rủi ro còn lại
- Dialog dùng `:has()` để thu hẹp modal 620px (đã dùng ở repo).
- Docs design-guidelines/editor chưa đụng (thuộc phase sau).
