---
title: "Parallel series and export priority"
description: "Xuất ZIP bộ đã xong không phải chờ bộ khác; bản self-host chạy 2 worker để nhiều bộ chạy song song"
status: completed
priority: P1
effort: "1d"
tags: [job-queue, worker, self-host]
created: 2026-11-10
---

# Parallel series and export priority

## Overview

Người dùng báo hai lỗi:
1. Bộ 1 đã xong nhưng không tải ZIP được khi bộ 2 đang chạy.
2. Ba bộ không chạy song song: bộ 1 xong thì bộ 2 mới chạy.

Nguyên nhân đã chứng minh bằng test trên DB thật:
- Claim xếp theo `priority, created_at` (`apps/api/src/jobs/queue.ts:130`).
- `enqueueExport` để priority mặc định 100 (`apps/api/src/jobs/enqueue.ts:420`), bằng `page.prepare`. Còn lô dịch là 50 (`CHAIN_PRIORITY`).
- Kết quả: export bộ 1 bị lấy cuối cùng (7/7), lô dịch bộ 2 tạo sau vẫn lên vị trí 1.
- Worker lấy 1 job rồi chạy tuần tự (`worker/mtl_worker/main.py:218`), và self-host chỉ có 1 worker.

Hướng đã chốt:
- Job người dùng đang ngồi chờ thì cho chạy trước.
- Self-host chạy mặc định 2 worker: người dùng muốn dịch nhiều chương cùng lúc, đã chấp nhận tốn RAM hơn (chốt 2026-11-10). Server đã hỗ trợ sẵn nhiều worker: claim dùng `SKIP LOCKED` và đã có test 2 worker, fencing theo lease từng job, model tải về nguyên tử.
- Đã bỏ phương án "2 làn trong 1 worker" vì phải sửa nhiều hơn mà lợi ích chỉ là tiết kiệm RAM.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Xuất file của bộ đã xong chạy ngay khi worker xong job hiện tại | P1 |
| 2 | Nhiều bộ chạy cùng lúc trên bản Docker mặc định | P1 |
| 3 | Docs ghi RAM tối thiểu theo số đo thật cho mặc định 2 worker | P1 |

## Phases

| # | Phase | Status | Phụ thuộc |
|---|-------|--------|-----------|
| 1 | [Đo RAM / CPU một worker](./phase-01-measure-worker-resources.md) | Done | — |
| 2 | [Ưu tiên job người dùng đang chờ](./phase-02-interactive-job-priority.md) | Done | — |
| 3 | [Hai worker trong self-host](./phase-03-two-workers-in-self-host.md) | Done | Phase 1 |

Phase 2 độc lập, làm và commit trước được vì đó là phần sửa trực tiếp lỗi ZIP.

## Quan hệ với plan khác

`261109-1709-self-host-first-run-and-ui-polish` (in-progress, mọi phase đã Done) cũng sửa `docker-compose.yml` và
`docs/self-host.md`. Không chặn nhau. Chỉ cần làm phase 3 trên nhánh đã có thay đổi đó để tránh conflict.

## Success Criteria

- [x] Test API: export tạo sau backlog `page.prepare` và lô dịch của chương khác vẫn được claim đầu tiên.
- [x] `docker compose up -d` chạy đủ số worker mặc định. Mỗi worker có `worker_id` riêng và số luồng onnxruntime đã chia.
- [x] Hai chương commit liên tiếp có job chạy chồng thời gian (xem trong `jobs.claimed_at`).
- [x] `docs/self-host.md`, `docs/job-queue-worker.md`, chú thích trong `docker-compose.yml` ghi đúng số worker, RAM tối thiểu, `MTL_WORKERS` / `MTL_THREADS`.

## Gate

- `pnpm --filter @mtl/api test` (ít nhất `test/queue.test.ts`) và `pnpm --filter @mtl/api test:unit`
- `cd worker && uv run pytest`
- Self-host smoke: `docker compose up -d` bằng image build local, chạy 2–3 chương thật.

## Kết quả (2026-11-10)

- Số đo + smoke: [reports/measure-worker-resources-report.md](./reports/measure-worker-resources-report.md). Không OOM.
  RAM tối thiểu: 2 worker ≥ 10 GB (nên 12 GB), 1 worker ≥ 6 GB.
- Xuất ZIP lúc còn 26 job xoá chữ của chương khác đang chờ: claim sau 9,5 s (đợi worker xong trang đang làm).
- 2 worker chia luồng (6/worker): xoá chữ ~10 s/trang trên toàn hệ, so với ~25 s/trang khi 1 worker (arm64, 12 nhân).
- Review: [reports/code-review-parallel-series-and-export-priority-report.md](./reports/code-review-parallel-series-and-export-priority-report.md).
- Giới hạn đã ghi trong docs: job lấy theo thứ tự tạo, nên chương sau chỉ bắt đầu khi chương trước hết trang chờ xoá
  chữ. Chưa chia lượt theo chương / theo người dùng.

## Open questions

- Có cần chia lượt claim theo chương (chương 2 bắt đầu ngay, không đợi chương 1 hết trang chờ xoá chữ) không? Nếu có
  thì cần plan riêng, vì phải đổi thứ tự claim trong `queue.ts`.

<!-- slug: parallel-series-and-export-priority -->
