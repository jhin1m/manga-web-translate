---
phase: 1
title: "Đo RAM / CPU một worker"
status: completed
priority: P1
effort: "2h"
dependencies: []
---

# Phase 1: Đo RAM / CPU một worker

## Overview
Lấy số đo RAM và CPU thật của một worker trong Docker, để ghi RAM tối thiểu cho mặc định 2 worker vào docs. Phase này không sửa code.

## Requirements
- Số đo trên image worker thật (`infra/docker/worker.Dockerfile`), chạy trong compose self-host. Không đo bằng `uv run` trên host, vì RAM khác nhau.
- Đo 4 trạng thái: rảnh sau khi nạp model; đang `page.prepare` trang strip lớn (dài cỡ ≥ 10000px); đang `chapter.translate`; đang `chapter.export` ZIP cả chương.

## Implementation Steps
1. Build image local: `docker build -f infra/docker/worker.Dockerfile -t mtl-worker:dev .`, và image app tương ứng. Chạy `MTL_TAG=dev docker compose up -d` trong một thư mục test riêng có `./data` trống.
2. Đợi log `mtl-worker … mode=loop`, rồi ghi `docker stats --no-stream mtl-local-worker-1`.
3. Commit một chương strip dài và một chương manga (khoảng 20 trang). Chạy `docker stats` theo nhịp 1s ra file, lấy giá trị đỉnh của từng loại job.
4. Ghi số nhân CPU trong VM Docker (`docker run --rm alpine nproc`) và thời gian `page.prepare` trung bình mỗi trang (từ log `job page.prepare … (Ns)`).
5. Chạy thử 2 worker cùng mặc định luồng (`docker compose up -d --scale worker=2`). Ghi lại thời gian `page.prepare` mỗi trang khi 2 worker cùng xoá chữ, để có số trước/sau cho việc chia luồng ở phase 3.
6. Ghi kết quả vào `reports/measure-worker-resources-report.md`.

## Dùng số đo thế nào (áp ở phase 3)
Mặc định **2 worker** đã chốt (2026-11-10): người dùng muốn dịch nhiều chương cùng lúc. Số đo không đổi quyết định này, chỉ dùng để ghi docs:
- `peak_worker` = RAM đỉnh lớn nhất của các job đã đo. `base` = app + jobs + postgres lúc chạy (đo luôn).
- Docs ghi RAM tối thiểu cho Docker = `2 × peak_worker + base`, làm tròn lên GB. Kèm dòng "máy ít RAM hơn mức này → `MTL_WORKERS=1`" và mức RAM cho 1 worker = `peak_worker + base`.
- Nếu 2 worker bị OOM kill ngay trong VM Docker mặc định khi đo, **dừng và báo lại** trước khi làm phase 3. Không tự đổi mặc định.

## Success Criteria
- [x] Report có bảng RAM rảnh/đỉnh theo loại job, `base`, số nhân CPU, thời gian prepare mỗi trang khi 1 và 2 worker.
- [x] Report ghi RAM tối thiểu cho 2 worker và cho 1 worker, theo cách tính ở trên.

## Risk Assessment
- Docker Desktop Mac giới hạn RAM VM: nếu worker bị OOM kill khi đo 2 worker thì ghi lại và báo người dùng (xem trên).
- Model tải lần đầu ~1,1 GB: dùng lại `./data/models` giữa các lần đo.
