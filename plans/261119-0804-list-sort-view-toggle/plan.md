---
title: "Sắp xếp + Lưới/Danh sách cho series và chương"
description: "Home và màn series: chọn tiêu chí sắp xếp, đảo chiều, chuyển lưới/danh sách (không thumb); nhớ theo màn trong localStorage"
status: completed
priority: P2
effort: "4h"
tags: [web, ux]
created: 2026-11-19
---

# Sắp xếp + Lưới/Danh sách cho series và chương

## Overview

Danh sách series (home) và chương (màn series) hiện chỉ có lưới thẻ có bìa và thứ tự cố định do API trả (series: hoạt
động gần nhất; chương: số chương tăng). API trả toàn bộ, không phân trang → sắp xếp và đổi dạng làm hoàn toàn ở web.
Dạng Danh sách dùng chung `SeriesCard` / `ChapterCard` với `layout="list"` (bỏ ảnh, CSS dạng hàng) để không lặp logic
xoá / xác nhận / thả file tải tiếp; selector `.card[data-series]`, `.card[data-chapter]` giữ nguyên.

Ngoài phạm vi: sort/phân trang server, đồng bộ lựa chọn giữa máy, sắp theo trạng thái, kéo thả tự xếp, nhớ riêng
từng series, thứ tự drawer Hoạt động.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Chọn tiêu chí + đảo chiều sắp xếp ở home (Hoạt động gần nhất · Tên · Ngày tạo · Số chương) và màn series (Số chương · Cập nhật · Ngày tạo) | P1 |
| 2 | Chuyển Lưới / Danh sách; Danh sách không ảnh, giữ trạng thái, Sửa/Xoá, xác nhận, thả file tải tiếp, vạch tiến độ mỏng | P1 |
| 3 | Nhớ lựa chọn theo màn (localStorage, an toàn khi bị chặn); mặc định giữ như hiện tại (lưới, thứ tự cũ) | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Sắp xếp + Lưới/Danh sách](./phase-01-start.md) | Pending |

## Success Criteria

- [x] Đổi tiêu chí / chiều → thứ tự đổi ngay, đúng ở cả hai màn; tìm series vẫn dùng được cùng sắp xếp.
- [x] Dạng Danh sách không có `<img>`; xoá, xác nhận xoá, thả file tải tiếp vẫn chạy.
- [x] Tải lại trang giữ dạng + cách xếp của từng màn; localStorage lỗi → mặc định, không vỡ trang.
- [x] Danh sách không cuộn ngang ở bề ngang điện thoại (375px).
- [x] Unit test hàm sắp xếp + prefs; e2e chuyển dạng / sắp xếp / tải lại; e2e cũ qua; typecheck + biome + vitest xanh.

<!-- slug: list-sort-view-toggle -->