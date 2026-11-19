# Sắp xếp và chuyển Lưới / Danh sách cho series và chương

**Date**: 2026-11-19
**Severity**: Low (tính năng UI nhỏ, chỉ web, không migration)
**Component**: web (`features/home/list-prefs.ts`, `list-toolbar.tsx`, `home-page.tsx`, `home.css`, `features/series/series-page.tsx`)
**Status**: Xong trên `main`, phát hành trong 0.5.0. Typecheck, biome, vitest 568/568, e2e `list-sort-view` + `series-manage` 12/12 đều xanh.

## Đã làm gì

Plan `plans/261119-0804-list-sort-view-toggle/`. Home và màn series có thanh "Sắp xếp theo", nút đảo chiều, và cặp nút
Lưới / Danh sách. Sắp xếp làm ở web vì API trả đủ danh sách. Mỗi màn nhớ lựa chọn riêng trong localStorage
(`mtl.list.series`, `mtl.list.chapters`). Mặc định giữ đúng thứ tự cũ để người dùng hiện tại không thấy app đổi.

## Quyết định

- Dạng Danh sách dùng lại `SeriesCard` / `ChapterCard` với `layout="list"` thay vì khôi phục `SeriesRow` / `ChapterLine`
  bản cũ. Logic xoá, xác nhận, thả file tải tiếp không bị nhân đôi, selector `.card[data-…]` của e2e cũ giữ nguyên.
- Nhãn nút chiều đi theo nghĩa của tiêu chí ("A→Z", "Mới trước", "Tăng dần") thay vì một mũi tên trơn, để người dùng
  không phải đoán "tăng" là cũ trước hay mới trước.
- Ở dạng danh sách, xác nhận xoá mở thành dòng dưới hàng. Kiểu phủ kín như ở lưới không vừa với hàng cao 44px.

## Phần đáng nhớ

Biome `noDescendingSpecificity` bắt 6 cảnh báo mới khi thêm `.block-head .list-view .icon-btn` và các selector
`.card-list …`. Nguyên nhân là các selector cùng đuôi `.icon-btn` / `.card-name` ở phía sau file có độ ưu tiên thấp hơn.
Đã sửa bằng class riêng `.view-btn` cho nút chọn dạng và `:where(.card-list)` để không tăng độ ưu tiên.

## Còn lại

Vạch tiến độ dưới hàng chương đang chạy chưa được nhìn tận mắt, vì lúc chụp màn hình không có chương nào đang chạy.
CSS dùng lại `.card-progress` với `.card` làm gốc định vị.
