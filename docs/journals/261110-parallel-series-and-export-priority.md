# Xuất ZIP kẹt sau backlog của bộ khác, và self-host chạy 2 worker

**Date**: 2026-11-10
**Severity**: High (người dùng không tải được ZIP của bộ đã xong; đã sửa)
**Component**: API job queue (`enqueue.ts`, `queue.ts`), worker (`main.py`), `docker-compose.yml`, docs self-host
**Status**: Đã commit trên `main` (`b9062d1`, `ee640ec`), phát hành ở tag `v0.1.0-rc.3`; chia lượt claim theo chương làm plan riêng

## Mục tiêu

Plan `plans/261110-1420-parallel-series-and-export-priority/`. Người dùng báo hai lỗi: bộ 1 đã xong nhưng không xuất được ZIP khi bộ 2 đang chạy, và nhiều bộ không chạy song song.

## Nguyên nhân

Claim xếp theo `priority, created_at` (`queue.ts:130`). `enqueueExport` không đặt priority nên lấy mặc định 100, bằng `page.prepare`, còn lô dịch là 50. Export của bộ 1 bị lấy cuối cùng (7/7) sau mọi job xoá chữ của bộ 2. Worker lại chỉ chạy tuần tự và self-host chỉ có 1 worker.

## Quyết định

- `INTERACTIVE_PRIORITY = 10` cho `chapter.export`, `page.reinpaint`, `page.ocr_region`. Job đang chạy không bị ngắt, chỉ cần chạy ngay khi worker rảnh. Test đi qua `enqueueExport` thật (đã red-check: bỏ priority thì test đỏ). Smoke: export được claim sau 9,5 s dù còn 26 job prepare xếp hàng.
- Self-host mặc định 2 worker (`MTL_WORKERS`), luồng chia `MTL_THREADS` hoặc `nproc // MTL_WORKERS`, `worker_id` = hostname. Bỏ phương án "2 làn trong 1 worker": sửa nhiều hơn mà chỉ tiết kiệm RAM.

## Những điều bất ngờ

- RAM đo được: đỉnh 4687 MiB mỗi worker. Model nạp lười và arena của onnxruntime không bao giờ trả lại, nên worker rảnh đã thấy đủ ngôn ngữ vẫn ngồi ở ~4,5 GB; phần nền tới 669 MiB. Docs cũ ghi "≥ 4 GB" là sai ngay cả với 1 worker. Giờ ghi ≥ 10 GB (nên 12 GB) cho 2 worker, ≥ 6 GB cho 1. Ngưỡng 10 GB chỉ dư ~2% và chưa thử trên VM đúng 10 GiB, chỉ đo trên arm64 15,66 GiB.
- Hiệu năng ngược trực giác (arm64, 12 nhân): 2 worker × 6 luồng ≈ 10 s/trang toàn hệ, 1 worker × 12 luồng ≈ 25 s/trang. Một job chạy 6 luồng còn nhanh hơn 12 luồng (trung vị 17,6 s so với 27,2 s). Chưa xử lý cho `MTL_WORKERS=1`, nó vẫn để onnxruntime tự chọn.

## Review bắt được

- `docker compose pull` không bao giờ cập nhật `docker-compose.yml`. Người dùng đã báo lỗi chính là bản cài cũ: họ sẽ nhận image mới nhưng vẫn 1 worker và không bao giờ thấy `MTL_WORKERS`. Docs "Cập nhật" và `README.md` giờ bắt tải lại compose.
- Compose trên `main` tới tay người dùng trước image mới. Lần này vô hại (worker cũ bỏ qua biến lạ), nhưng lần sau thì không: đổi compose phải merge cùng lúc với tag.
- Giá trị env sai từng chặn cả `--threads` tường minh vì default tính trước khi parse (`MTL_THREADS=abc mtl-worker --threads 2` thoát lỗi). Đã đổi sang tính sau parse.
- Docs ban đầu hứa "số worker = số chương chạy cùng lúc", sai so với thứ tự claim. Đã sửa lời.

## Bài học

- Mặc định ngầm (priority 100) là một quyết định. Mọi `insertJob` mới phải tự hỏi nó xếp ở đâu so với job của chương khác.
- Số RAM trong docs phải từ đo thật, không từ ước lượng.
- Phát hành file cấu hình qua cơ chế khác với image thì phải có bước cập nhật riêng và thứ tự merge riêng.

## Việc còn lại

- Câu hỏi cho jhin1m: claim vẫn oldest-first, nên bộ/chương 2 chỉ bắt đầu xoá chữ khi chương 1 hết backlog prepare. Chương 60 trang đứng trước chương 5 trang thì chương nhỏ đợi cỡ 9 phút. Chia lượt theo chương cần plan riêng (đổi thứ tự claim trong `queue.ts`). Hiện đã ghi thành giới hạn trong docs.
- Không commit nhầm `qa-before-delete.png` và `apps/web/.claude/`.
- Chế độ VPS nhiều người: export priority 10 cho phép một user chen hàng. Chưa chặn, đã ghi giới hạn.

AgentWiki publish skipped: CLI `agentwiki` không có trong máy, không có MCP AgentWiki.
