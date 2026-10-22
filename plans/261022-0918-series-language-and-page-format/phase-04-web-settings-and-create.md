---
phase: 4
title: "Web cài đặt + tạo series"
status: pending
priority: P1
effort: "4h"
dependencies: [2]
---

# Phase 4: Web cài đặt + tạo series

## Overview
Form Cài đặt series cho chọn nguồn/đích/định dạng truyện; form tạo series (trang chủ + series mới khi thả ảnh)
thêm select nguồn; nhãn xưng hô trung tính theo đích.

## Requirements
- Danh sách lấy từ hằng `@mtl/shared` (không lặp literal).
- Nguồn ∉ `TESTED_SOURCE_LANGS` → dòng ghi chú nhỏ dưới select: "Chưa kiểm định kỹ — kết quả có thể kém hơn tiếng Hàn". Không chặn lưu.
- Select "Định dạng truyện": `strip` = "Cuộn dọc (manhwa/manhua)", `pages` = "Từng trang (manga)"; ghi chú "Áp dụng cho chương upload sau khi lưu".
- Honorific: option "Chuyển sang cách gọi tự nhiên của ngôn ngữ đích" / "Giữ nguyên kính ngữ (phiên âm)".
- Pronoun rules: nhãn "Cách xưng hô / gọi nhau"; placeholder `address` theo đích (vi: "anh/em"; en: "Boss / kid"; khác: "cách gọi").
- Tạo series: select nguồn mặc định ko, gọn 1 dòng cạnh ô tên (memory: UI tối giản). Không gửi `page_format` — server suy ra.
- Commit chương: web tiếp tục gửi body rỗng (server dùng page_format) — không đổi `apps/web/src/features/chapter/api.ts:98`.
- Header series (`series-page.tsx:93`) `LANG` map đủ 6 đích + 4 nguồn.

## Related Code Files
- Modify: `apps/web/src/features/series/api.ts` (types `source_lang`, `target_lang`, `page_format`)
- Modify: `apps/web/src/features/series/series-settings-form.tsx`
- Modify: `apps/web/src/features/series/series-page.tsx` (`LANG`)
- Modify: `apps/web/src/features/home/home-page.tsx` (form tạo series), `apps/web/src/features/home/new-chapter-confirm-row.tsx` (+ `.ts` nếu logic tách ở đó)
- Create (nếu cần dùng chung): `apps/web/src/features/series/lang-labels.ts` — nhãn tiếng Việt cho mã ngôn ngữ + định dạng
- Modify/Create tests: unit cho `lang-labels`/form helper; e2e `apps/web/e2e/series-manage.spec.ts` (đổi nguồn ja → page_format tự hiện "Từng trang" khi tạo, sửa đích en lưu được), `apps/web/e2e/upload-chapter.spec.ts` (series pages → commit ra mỗi file 1 trang, nếu e2e có worker giả lập ingest; không thì kiểm payload qua API)

## Implementation Steps
1. Types + nhãn dùng chung.
2. Settings form: 3 select (nguồn, đích, định dạng) + ghi chú; nhãn xưng hô mới.
3. Form tạo series 2 chỗ: thêm select nguồn, truyền `source_lang` vào `createSeries`.
4. `LANG` ở header.
5. `pnpm --filter @mtl/web test` + e2e liên quan, rồi toàn bộ `pnpm --filter @mtl/web e2e`.

## Success Criteria
- [x] Tạo series "ja" từ trang chủ → mở Cài đặt thấy "Từng trang (manga)".
- [x] Đổi đích sang en lưu được, header hiện "Tiếng Nhật → Tiếng Anh".
- [x] Không thêm nút/bước mới vào luồng thả ảnh ngoài 1 select nguồn.

## Risk Assessment
- `click-budget.spec.ts` có thể đếm thao tác luồng tạo series — select mặc định ko nên không tăng click; kiểm lại spec.
