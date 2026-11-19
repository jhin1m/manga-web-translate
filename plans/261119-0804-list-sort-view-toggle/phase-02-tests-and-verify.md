---
title: "Phase 2: Tests-and-verify"
status: completed
---

# Phase 2: Tests-and-verify

## Overview

Khoá hành vi sắp xếp / prefs bằng unit test, chuyển dạng + sắp xếp + nhớ lựa chọn bằng e2e, rồi chạy gate nhanh cho
thay đổi UI.

## Requirements

- [x] Unit (`list-prefs.test.ts`): mỗi tiêu chí cả hai chiều; tên tiếng Việt + số ("Ch 2" < "Ch 10"); số chương thập phân ("10.5"); hoà ổn định; prefs hỏng/thiếu/storage ném lỗi → mặc định.
- [x] E2e (`apps/web/e2e/list-sort-view.spec.ts`): home chuyển Danh sách → thẻ series không có `img`, đổi Tên A→Z rồi đảo chiều → thứ tự đổi; reload giữ; màn series chuyển Danh sách + sắp Số chương giảm dần → thứ tự đổi; xoá chương ở dạng danh sách vẫn qua xác nhận.
- [x] E2e cũ `series-manage.spec.ts`, `upload-chapter.spec.ts` vẫn qua.

## Implementation Steps

1. Viết unit test, chạy `pnpm --filter web exec vitest run src/features/home/list-prefs.test.ts`.
2. Viết e2e theo mẫu `series-manage.spec.ts` (seed qua API, `helpers.ts`), chạy riêng spec mới + spec cũ liên quan.
3. Gate: typecheck web, `biome check` file đổi, vitest web — tuần tự, `nice`, 1 worker.

## Todo

- [x] Unit test list-prefs
- [x] E2e list-sort-view
- [x] Chạy e2e cũ liên quan
- [x] Typecheck + biome + vitest

## Success Criteria

Mọi lệnh trên xanh; không sửa yếu test cũ.
