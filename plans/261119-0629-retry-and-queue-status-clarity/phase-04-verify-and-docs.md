---
phase: 4
title: "Phase 4: Verify and docs"
status: pending
priority: P2
effort: "2h"
dependencies: [1, 2, 3]
---

# Phase 4: Verify and docs

## Overview

Gate nhanh (UI + API, không migration/dep native → không cần build image/smoke, theo memory mức kiểm), kiểm tay trên
dev không tốn tiền AI, cập nhật docs.

## Requirements

- Kiểm nhẹ CPU: chạy tuần tự, `nice`, không build amd64.
- Không gọi AI thật khi kiểm tay.

## Implementation Steps

1. Gate: `pnpm -r typecheck`, `pnpm biome check`, test đích api (queue-state) + web (status, next-action, primary-action, job-error).
2. Kiểm tay trên dev (stack dev có 1 worker):
   - Tạo 2 chương, commit `target: "prepared"` (chỉ xoá chữ + OCR, không AI) liên tiếp → chương 2 hiện "Đang chờ lượt · 1 chương đang chạy" ở chip và thẻ grid; tới lượt thì chuyển sang "Xoá chữ + OCR x/y".
   - `no_worker`: dev không bật local mode → kiểm bằng test integration (Phase 2), hoặc chạy API với `MTL_LOCAL_MODE=1` + dừng worker nếu tiện.
   - Retry: đánh dấu 2 trang `failed` trong DB dev như lần chụp ảnh trước → kiểm title nút, chip title nguyên nhân, thông báo sau khi bấm (bấm thật sẽ gọi AI → chỉ kiểm thông báo khi chương không có AI hoặc chặn bằng huỷ ngay). Xoá chương thử sau khi xong.
   - Chụp ảnh trước/sau lưu `plans/261119-0629-retry-and-queue-status-clarity/reports/`.
3. Docs:
   - `docs/job-queue-worker.md`: trường `chapter.queue` / `queue_state` + định nghĩa waiting/no_worker.
   - `docs/self-host.md` mục Worker: ý nghĩa "Đang chờ lượt" / "Đang chờ worker"; mục lỗi: "Chạy lại N trang" chỉ chạy trang lỗi.
4. Commit theo conventional (`feat(web)`, `feat(api)`, `docs`), không nhắc AI/mã plan.

## Success Criteria

- [x] Gate xanh, có output
- [x] Ảnh chụp chip/thẻ "Đang chờ lượt" và tooltip chạy lại
- [x] Docs khớp hành vi

## Risk Assessment

- Kiểm tay retry dễ lỡ gọi AI thật → không bấm nút retry trên chương có trang chưa dịch khi worker có key; ưu tiên kiểm thông báo bằng test.
