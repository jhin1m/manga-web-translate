---
phase: 3
title: "Phase 3: Lưới series + lưới chương (web)"
status: todo
priority: P1
effort: "5h"
dependencies: [2]
---

# Phase 3: Lưới series + lưới chương (web)

## Overview
Thay danh sách một dòng bằng lưới thẻ có ảnh: trang chủ (series: bìa + tên + trạng thái) và trang series (chương:
ảnh đầu + Ch.N + tên + trạng thái). Thêm mục "Ảnh bìa" trong cài đặt series.

## Requirements
- Functional:
  - **Thẻ series**: bìa 3:4 (`object-fit: cover; object-position: top`), tên (2 dòng, ellipsis), chấm trạng thái +
    "Ch.N · trạng thái" (giữ logic `nextAction` / `needsWork` hiện có), "{n} ch". Bấm thẻ → mở series. Icon Sửa
    (→ tab settings) / Xoá ở góc trên phải **luôn hiện** (nền mờ, đủ tương phản); Xoá → xác nhận tại chỗ phủ trên thẻ
    (tái dùng `DeleteSeriesConfirm`).
  - **Thẻ chương**: ảnh đầu 3:4, "Ch.N" đậm + tên chương (nếu có), chấm trạng thái, thời gian; thanh tiến độ dưới ảnh
    khi đang tải/xử lý; thẻ là drop target "thả lại file để tải tiếp" (giữ `data-drop`, gợi ý chữ hiển thị trên thẻ);
    icon Xoá góc.
  - Placeholder khi `src` null hoặc ảnh lỗi: ô màu theo theme + chữ cái đầu tên series / "Ch.N".
  - Cài đặt series: mục "Ảnh bìa" — xem trước, nút "Tải ảnh bìa…" (png/jpg/webp), nút "Dùng ảnh tự động" khi đang dùng
    bìa tuỳ chỉnh; lỗi hiện tại chỗ. Thành công → invalidate `seriesKeys.list()` + `seriesKeys.detail(id)`.
  - Ô tìm series, nút "+ Series", dải thả, dòng xác nhận giữ nguyên vị trí.
- Non-functional:
  - Lưới `grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))`; ≤ 480px còn 2 cột, gutter 16px; không cuộn
    ngang.
  - `<img loading="lazy" decoding="async">`, có `width/height` (aspect-ratio) để không nhảy layout.
  - Polling 5s của trang series không làm nháy ảnh: `src` ổn định; chương đang `ingesting` gắn `?s={status}` để ảnh
    tải lại khi trạng thái đổi (lần 404 → placeholder, xong upload → có ảnh).
  - A11y: thẻ là `<Link>` có tên đọc được; nút icon có `aria-label`; focus ring thấy rõ; giữ `data-series` /
    `data-chapter` cho test/smoke.
  - Theme sáng/tối theo token CSS hiện có (`styles/`), không màu cứng.

## Architecture
- `features/home/home-page.tsx`: `SeriesRows` → `SeriesGrid`, `SeriesRow` → `SeriesCard`. Tách component thẻ dùng
  chung khung ảnh: `features/home/cover-image.tsx` (`CoverImage({ src, fallback, alt })`, xử lý onError →
  placeholder, reset khi `src` đổi).
- `features/series/series-page.tsx`: hàng chương → `ChapterCard` (giữ toàn bộ logic action/drop/progress, chỉ đổi
  markup).
- `features/series/series-settings-form.tsx`: section `CoverSection` (component mới `features/series/cover-section.tsx`),
  API `uploadSeriesCover(id, file)` (FormData) / `resetSeriesCover(id)` trong `features/series/api.ts`.
- CSS: thêm vào `features/home/home.css` (lưới + thẻ dùng chung cả 2 trang); bỏ CSS hàng không còn dùng.

## Related Code Files
- Create: `apps/web/src/features/home/cover-image.tsx`, `apps/web/src/features/series/cover-section.tsx`
- Modify: `apps/web/src/features/home/home-page.tsx`, `apps/web/src/features/home/home.css`,
  `apps/web/src/features/series/series-page.tsx`, `apps/web/src/features/series/series-settings-form.tsx`,
  `apps/web/src/features/series/api.ts`, test web liên quan (grep `row-item`, `data-series`, `data-chapter`)
- Delete: CSS hàng series/chương không còn dùng (sau khi grep)

## Implementation Steps
1. Grep test + `infra/selfhost-smoke.mjs` + QA script tìm selector `.row-item`, `.row-open`, `.ch-open`,
   `data-series`, `data-chapter` → ghi danh sách phải cập nhật.
2. `CoverImage` + CSS lưới/thẻ (token theme, mobile 2 cột).
3. `SeriesCard` / `SeriesGrid` trên trang chủ; xác nhận xoá phủ thẻ.
4. `ChapterCard` trên trang series; drop "tải tiếp" + progress trong thẻ.
5. `CoverSection` trong cài đặt series + API client.
6. Cập nhật test/selector; `pnpm --filter @mtl/web test`, typecheck, lint.
7. Chạy app (`pnpm dev:all`), kiểm bằng trình duyệt: trang chủ (0 series, 1, 20+), trang series (chương nháp đang
   tải, đang dịch, đã xuất), sáng/tối, rộng 375px; đổi / bỏ bìa.

## Success Criteria
- [ ] Trang chủ, trang series hiện lưới ảnh; series/chương cũ có ảnh (qua `/api/thumbs`).
- [ ] Xoá series / chương vẫn xác nhận tại chỗ; Sửa vẫn tới tab settings.
- [ ] Thả lại file vào thẻ chương "tải tiếp" vẫn chạy.
- [ ] Chương đang tải: placeholder → ảnh khi upload xong, không nháy mỗi lượt polling.
- [ ] 375px: 2 cột, không cuộn ngang; theme tối đúng màu.
- [ ] Đổi / bỏ bìa hiện ngay trên trang chủ.

## Risk Assessment
- Mất thông tin so với hàng cũ (nhiều chữ trạng thái trong thẻ nhỏ): giữ chấm màu + nhãn ngắn, `title` tooltip cho
  chữ dài.
- Selector smoke/QA đổi → smoke đỏ ở phase 4: bước 1 grep trước.
- Ảnh 404 lặp khi polling: `src` ổn định + query `?s=` chỉ đổi khi status đổi.
- Rollback: revert commit phase (API phase 2 vẫn tương thích ngược — trường mới chỉ thêm).
