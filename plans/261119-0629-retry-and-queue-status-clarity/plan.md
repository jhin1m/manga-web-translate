---
title: "Retry and queue status clarity"
description: "Nói rõ 'Chạy lại' chỉ chạy trang lỗi + nhãn 'Đang chờ lượt' cho chương xếp hàng chờ worker"
status: completed
priority: P1
effort: "1d"
tags: [web, api, self-host, ux]
created: 2026-11-19
---

# Retry and queue status clarity

## Overview

Câu hỏi người dùng self-host:
1. Dịch lỗi giữa chừng thì bấm gì, chạy lại từ đầu hay từ trang lỗi? → Hành vi đã đúng (chỉ chạy trang lỗi) nhưng UI
   không nói rõ: tooltip mơ hồ, thông báo đếm "job", gợi ý bảo chuột phải.
2. Dịch nhiều chương có vào hàng đợi không? → Có, nhưng chương chờ worker hiện "Đang xử lý" / "Xoá chữ + OCR 0/N"
   giống chương đang chạy → tưởng treo.

Ngoài phạm vi: `MTL_WORKERS=auto` (đã bỏ — updater khôi phục `MTL_WORKERS` bằng đếm container, đổi sang 1 container
supervisor làm bản cập nhật từ 0.4.x kẹt cố định; rủi ro > lợi ích). Không đổi thumbnail trang (đã có "Chờ xoá chữ").

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Người dùng biết nút nào để chạy lại và chắc chắn trang đã xong không bị làm lại | P1 |
| 2 | Chương xếp hàng chờ worker có nhãn riêng, không giống chương đang chạy | P1 |
| 3 | Self-host: phân biệt "chờ lượt" với "không có worker nào chạy" | P2 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Retry wording](./phase-01-start.md) | Pending |
| 2 | [Phase 2: Queue waiting state API](./phase-02-queue-waiting-state-api.md) | Pending |
| 3 | [Phase 3: Queue waiting labels web](./phase-03-queue-waiting-labels-web.md) | Pending |
| 4 | [Phase 4: Verify and docs](./phase-04-verify-and-docs.md) | Pending |

Phụ thuộc: 1 độc lập; 3 cần 2; 4 cuối. Không đụng migration, compose, worker Python.

## Success Criteria

- [ ] Nút/tooltip/thông báo chạy lại nói "N trang lỗi", "trang đã xong giữ nguyên"; không còn gợi ý chỉ-chuột-phải
- [ ] Chip chương + thẻ chương ở grid series/home hiện "Đang chờ lượt" khi chương có job chờ mà không job nào chạy
- [ ] Self-host không thấy worker sống → "Đang chờ worker" kèm gợi ý xem log
- [ ] Chương đang chờ không vẽ thanh tiến độ chạy qua lại
- [ ] typecheck + biome + test đích (api, web) xanh; kiểm tay trên dev không tốn tiền AI

## Unresolved

- Không có.

<!-- slug: retry-and-queue-status-clarity -->
