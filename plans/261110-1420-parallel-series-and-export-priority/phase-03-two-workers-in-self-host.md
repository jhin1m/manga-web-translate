---
phase: 3
title: "Hai worker trong self-host"
status: completed
priority: P1
effort: "4h"
dependencies: [1]
---

# Phase 3: Hai worker trong self-host

## Overview
Bản Docker chạy mặc định 2 worker để nhiều bộ chạy cùng lúc (người dùng yêu cầu, đã chốt 2026-11-10). Một biến `MTL_WORKERS` quyết định cả số worker lẫn cách chia nhân CPU.

## Requirements
- `MTL_WORKERS` (mặc định 2) điều khiển `deploy.replicas` của service `worker`.
- Worker đọc `MTL_THREADS`. Nếu không đặt thì tự tính `max(1, nproc // MTL_WORKERS)`, để 2 worker cùng xoá chữ không tranh nhau toàn bộ nhân CPU. `--threads` vẫn thắng cả hai.
- Mỗi replica có `worker_id` riêng: bỏ `MTL_WORKER_ID: local` khỏi compose, worker sẽ dùng mặc định là hostname = id container.
- Không đổi API/server: claim song song đã có test (`queue.test.ts`, "2 workers claiming 1000 jobs"), fencing theo `lease_token` từng job, hai replica dùng chung token được.

## Architecture
```python
# worker/mtl_worker/main.py
def default_threads(env=os.environ) -> int:
    """MTL_THREADS > chia đều nhân cho MTL_WORKERS replica (compose) > 0 = mặc định onnxruntime."""
    if env.get("MTL_THREADS"):
        return int(env["MTL_THREADS"])
    workers = int(env.get("MTL_WORKERS") or 1)
    if workers <= 1:
        return 0
    return max(1, len(os.sched_getaffinity(0)) // workers)  # Linux container; macOS không có → os.cpu_count()

ap.add_argument("--threads", type=int, default=default_threads(), ...)
```
```yaml
# docker-compose.yml — service worker
    environment:
      MTL_WORKERS: ${MTL_WORKERS:-2}   # worker dùng để chia nhân CPU; phải khớp replicas
    deploy:
      replicas: ${MTL_WORKERS:-2}
```

## Related Code Files
- Modify: `worker/mtl_worker/main.py`: `default_threads`, log số luồng lúc khởi động
- Create: `worker/tests/test_worker_threads.py`: unit test `default_threads`
- Modify: `docker-compose.yml`: replicas, `MTL_WORKERS`, bỏ `MTL_WORKER_ID`, chú thích RAM ở đầu file (dòng `Biến tuỳ chọn`)
- Modify: `docs/self-host.md`: RAM tối thiểu theo phase 1, bảng biến (`MTL_WORKERS`, `MTL_THREADS`), mục "chạy nhanh hơn / máy yếu → `MTL_WORKERS=1`"
- Modify: `docs/job-queue-worker.md`: thêm một dòng về `MTL_THREADS` / `MTL_WORKERS` và việc nhiều worker chạy song song

## Implementation Steps
1. Thêm `default_threads` và unit test: không đặt gì → 0; `MTL_WORKERS=2` trên 8 nhân → 4; `MTL_THREADS=3` → 3; `MTL_WORKERS=16` trên 4 nhân → 1. Mock `sched_getaffinity` / `cpu_count`.
2. Log khởi động in `threads=N` (dòng `mtl-worker %s id=%s …`) để người dùng thấy cấu hình qua `docker compose logs worker`.
3. Sửa compose. **Kiểm thật** bằng `docker compose config` rằng `deploy.replicas: ${MTL_WORKERS:-2}` được nội suy thành số. Nếu compose báo lỗi kiểu dữ liệu thì bỏ replicas khỏi file và hướng dẫn `docker compose up -d --scale worker=N` thay thế.
4. Kiểm luồng cập nhật trong docs: `docker compose pull && docker compose up -d` tạo lại đủ replicas; `stop_grace_period` 100s áp cho từng container.
5. Kiểm thông báo trong docs về thu hồi token (`docker compose restart app worker`): lệnh này restart mọi replica, nên giữ nguyên.
6. Smoke trên image build local:
   - Commit 3 chương liên tiếp.
   - Query `select type, chapter_id, worker_id, claimed_at, updated_at from jobs order by claimed_at` → có job của 2 chương khác nhau chạy chồng thời gian, mang 2 `worker_id` khác nhau.
   - Bấm xuất ZIP một chương đã xong khi 2 chương còn lại đang chạy → có file sau khi một worker xong job hiện tại.
7. Sửa docs.

## Success Criteria
- [x] `uv run pytest` xanh, có test mới.
- [x] `docker compose config` hợp lệ. `docker compose ps` thấy đủ số worker, log mỗi worker có `id` và `threads` đúng.
- [x] Smoke bước 6 đạt.
- [x] Docs ghi RAM tối thiểu khớp số đo phase 1.

## Risk Assessment
- **RAM**: N worker nạp N bản model. Giảm thiểu bằng RAM tối thiểu đo ở phase 1 ghi trong docs, và hướng dẫn `MTL_WORKERS=1` cho máy yếu.
- **Kỳ vọng tốc độ**: xoá chữ + OCR chạy bằng CPU nên không nhanh gấp đôi, phần dịch mới chạy chồng được. Docs ghi rõ "nhiều chương chạy cùng lúc", không hứa "nhanh gấp N".
- **Rate limit API AI**: hai chương dịch cùng lúc thì số request đồng thời tăng gấp đôi, dễ gặp 429. Breaker sẵn có (≥ 5 lỗi trong 5' → dừng provider 2') xử lý được. Ghi một dòng trong docs.
- **`MTL_WORKERS` lệch với `--scale`**: ai dùng `--scale worker=3` mà không đổi `MTL_WORKERS` thì chia luồng sai, chỉ chậm chứ không hỏng. Docs dặn dùng `MTL_WORKERS`.
- **Lần đầu cài**: 2 worker cùng tải model vào `./data/models`. An toàn vì ghi file tạm rồi `replace` (`worker/mtl_pipeline/models.py:125-135`), chỉ tốn băng thông gấp đôi một lần.
- Rollback: `MTL_WORKERS=1 docker compose up -d`.
