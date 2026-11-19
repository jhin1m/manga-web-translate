---
title: "Phase 1: Sắp xếp + Lưới/Danh sách"
status: completed
---

# Phase 1: Sắp xếp + Lưới/Danh sách

## Overview

Thêm thanh điều khiển (Sắp xếp · ↑/↓ · Lưới/Danh sách) cho home và màn series, hàm sắp xếp thuần + lưu lựa chọn, và
biến thể `layout="list"` cho thẻ.

## Requirements

- [x] Home: tiêu chí `activity` (last_activity_at, mặc định desc), `title` (asc), `created` (desc), `chapters` (chapter_count, desc).
- [x] Màn series: `number` (mặc định asc), `updated` (desc), `created` (desc).
- [x] Đổi tiêu chí → đặt chiều mặc định của tiêu chí đó; nút ↑/↓ đảo chiều (aria-label nói rõ chiều hiện tại).
- [x] Tên so bằng `Intl.Collator("vi", { numeric: true, sensitivity: "base" })`; số chương so `Number()` rồi collator numeric khi NaN; hoà → `id` để ổn định.
- [x] Prefs `{ view, sort, dir }` theo khoá `mtl.list.series` / `mtl.list.chapters`; đọc/ghi bọc try/catch, giá trị lạ → mặc định.
- [x] `layout="list"`: không render `CoverImage`; hàng: tên · chấm + trạng thái · số chương / thời gian · icon; chương đang chạy có vạch tiến độ 2–3px dưới hàng; xác nhận xoá phủ trên hàng; drop target giữ nguyên.
- [x] Không cuộn ngang ở 375px (tên + trạng thái cắt "…").

## Implementation Steps

1. Tạo `apps/web/src/features/home/list-prefs.ts`: kiểu `ListView = "grid" | "list"`, `SortDir`, cấu hình tiêu chí
   (nhãn + chiều mặc định) cho series / chương, `sortSeries(list, sort, dir)`, `sortChapters(list, sort, dir)`,
   `useListPrefs(key, defaults)` (useState khởi tạo từ localStorage, ghi lại khi đổi; theo mẫu `safeStorage` ở
   `features/chapter/layout-prefs.ts`).
2. Tạo `apps/web/src/features/home/list-toolbar.tsx`: `<select aria-label="Sắp xếp">`, nút đảo chiều, cặp nút
   Lưới / Danh sách (`aria-pressed`); thêm icon vào `row-icons.tsx` (GridIcon, ListIcon, mũi tên sắp xếp).
3. `home-page.tsx`: `SeriesGrid` dùng prefs → lọc tìm rồi `sortSeries`; toolbar đặt trong `block-head` cạnh ô tìm /
   "+ Series"; `card-grid` ↔ `card-list` theo view; `SeriesCard` nhận `layout`, list thì bỏ `CoverImage`.
4. `series-page.tsx`: `ChapterList` thêm hàng toolbar phía trên danh sách (chỉ khi có chương); `sortChapters`;
   `ChapterCard` nhận `layout`, list thì bỏ ảnh và hiện vạch tiến độ dưới hàng khi `running`.
5. `home.css`: `.list-toolbar`, `.card-list` (cột, hàng viền chia), `.card-list .card` dạng hàng, `.card-list
   .card-open` flex với tên/trạng thái co giãn + ellipsis, `.card-list .card-actions` tĩnh bên phải (không hover
   overlay như lưới), `.card-list .card-confirm`, `.row-progress`; responsive ≤ 480px. Dùng token màu sẵn có.
6. Cập nhật docstring đầu file `home-page.tsx`, `series-page.tsx`.

## Todo

- [x] list-prefs.ts (sort + prefs)
- [x] list-toolbar.tsx + icons
- [x] Home: toolbar + sort + layout list
- [x] Series: toolbar + sort + layout list + vạch tiến độ
- [x] CSS dạng danh sách + responsive

## Success Criteria

Hai màn có toolbar chạy đúng, mặc định giống hệt trước (lưới, thứ tự cũ), dạng danh sách không ảnh và đủ thao tác.
Rollback: revert commit (chỉ web, không migration, khoá localStorage cũ bị bỏ qua vô hại).
