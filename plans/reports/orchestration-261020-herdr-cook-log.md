# Orchestration log — herdr cook MVP P1–P7

Plan: plans/261019-1847-manga-translate-editor-mvp/plan.md
Thứ tự: Wave 1 = P1 ‖ P2 → P3 → P4 → P5 → P6 → P7 (tối đa 2 pane).

| Thời điểm | Phase | Sự kiện | Chi tiết |
|---|---|---|---|
| 2026-10-20 15:52 | — | init | git init main, .gitignore, commit plans/ |
| 2026-10-20 15:58 | P1, P2 | quyết định | User cho phép controller chọn "Yes, I trust this folder" ở hộp thoại trust khi khởi động pane cho mọi worktree mtl-wt/pN |
| 2026-10-20 15:59 | P1 | start | worktree ../mtl-wt/p1, branch feat/p1-pipeline-spike-benchmark, pane w1H:p2, agent cook-p1 |
| 2026-10-20 15:59 | P2 | start | worktree ../mtl-wt/p2, branch feat/p2-monorepo-db-auth-storage, pane w1H:p3, agent cook-p2 |
| 2026-10-20 16:13 | P2 | done | cook-p2 báo DONE_WITH_CONCERNS (35/35 test). Concern: pane đã `pkill -f vite` có thể tắt dev server Vite khác ở cổng 5173 (báo user); dedupe chi phí nền tảng usage_ledger hoãn sang P3/P7; MinIO dùng image pgsty/minio; PageState cần đối chiếu hợp đồng layout P1 khi merge |
| 2026-10-20 16:15 | P2 | merge | Kiểm lại trong worktree xanh → merge --no-ff vào main (ca6d220). Main cần `.env` cục bộ (cp từ worktree, gitignored) để chạy test DB; sau đó typecheck/lint/test xanh |
| 2026-10-20 16:31 | P1 | done | cook-p1 báo DONE_WITH_CONCERNS (79 test). Đổi so với phase file: Pillow bỏ stroke_width, vẽ 4× rồi thu nhỏ; P5 phải vẽ chữ bằng Konva.Shape tự viết (docs/typeset-layout-contract.md). Gate GO tạm, phase-01-results ghi "chưa đo" |
| 2026-10-20 16:32 | P1 | quyết định | 2 câu hỏi mở của pane chốt mặc định an toàn: giữ 3 lớp lỗi + retryable=False, giữ gemini-2.5-flash. Controller yêu cầu sửa 1 lỗi mypy ở spike + ghi dòng gate vào phase-01 → commit 1743d14 |
| 2026-10-20 16:34 | P1 | merge | Kiểm lại worktree: pytest 79, ruff, mypy sạch → merge --no-ff (32d15cb); conflict .gitignore giải bằng gộp cả hai. Main: typecheck/lint/test xanh, worker pytest 77 pass 2 skip (weight ONNX không có trên main) |
| 2026-10-20 16:36 | P3 | start | worktree ../mtl-wt/p3, branch feat/p3-job-queue-worker, pane w1H:p4, agent cook-p3; prompt kèm ghi chú đối chiếu PageState với hợp đồng layout P1, tải lại weight, cấm pkill rộng |
| 2026-10-20 17:10 | P3 | done | cook-p3 báo DONE_WITH_CONCERNS (API 57 test, worker 99). Chưa đo: golden 40 slice, kill -9 ≤150s thật, ảnh 20000px e2e; chapter.export hoãn P6; breaker dùng chung mọi workspace |
| 2026-10-20 17:12 | P3 | quyết định | Worker Mac do team owner chạy (invite-only) → giữ server clamp số đếm + tin lớp lỗi, rủi ro ghi cho P8; huỷ ingest về draft: đồng ý. Yêu cầu sửa 7 lỗi mypy ở tests → sạch |
| 2026-10-20 17:15 | P3 | merge | Kiểm lại worktree xanh → merge --no-ff không conflict. Main: typecheck/lint/test xanh (API 57), worker pytest 97 pass 2 skip, mypy sạch |
| 2026-10-20 17:17 | P4 | start | worktree ../mtl-wt/p4, branch feat/p4-web-upload-series-progress, pane w1H:p8, agent cook-p4 |
| 2026-10-20 17:40 | P4 | done | cook-p4 báo DONE_WITH_CONCERNS (API 76, web 6). Lệch plan: client API viết tay (không hc<AppType>), route mount ở apps/api/src/app.ts. Còn mở: link upload hiệu lực ≤15' sau commit; glossary thiếu unique index; worktree dùng chung DB test |
| 2026-10-20 17:41 | P4 | quyết định | UI hướng A (dày thông tin, trung tính, 1 màu nhấn) giữ tạm, chờ owner duyệt; retry/dịch lại/huỷ không chặn 423 (job AI không ghi đè state khi chương khoá); unique index glossary giao cho P6 (sở hữu glossary) |
| 2026-10-20 17:41 | P1 | sự cố | Controller giải conflict .gitignore ở merge P1 bằng sed BSD (không hiểu `\|`) → còn sót 3 dấu conflict trên main; P4 đã xoá, merge P4 sửa main. Bài học: kiểm lại file sau khi giải conflict |
| 2026-10-20 17:42 | P4 | merge | Kiểm lại worktree xanh → merge --no-ff không conflict. Main: typecheck/lint/test xanh (API 76, web 6), worker pytest 97+2 skip, ruff/mypy sạch |
| 2026-10-20 17:44 | P5 | start | worktree ../mtl-wt/p5, branch feat/p5-editor-konva, pane w1H:p9, agent cook-p5; nhắc hợp đồng layout (Konva.Shape) |
| 2026-10-20 18:15 | P5 | done | cook-p5 báo DONE_WITH_CONCERNS. Chưa đo: mở 12k/20k px <2s, ≥50fps M1, Safari 18, reinpaint ≤15s worker thật, owner sửa chương 40 slice; conflict chưa xử lý chỉ trong bộ nhớ; 2 tab cùng trang ghi đè draft; undo bị xoá khi 409/AI cập nhật |
| 2026-10-20 18:17 | P5 | quyết định | Tiêu chí hiệu năng/Safari → chờ owner kiểm thủ công, đo lại ở P7; cho export serial từ use-chapter-lock.ts (file P4) để lượt lưu cuối đi chung chuỗi khoá → đã làm; đóng tab vẫn dựa IndexedDB khôi phục; tách chunk editor → P6 |
| 2026-10-20 18:19 | P5 | merge | Kiểm lại worktree xanh (web 46, API 89, e2e 2/2) → merge --no-ff không conflict. Main: typecheck/lint/test xanh, worker pytest 97+2 skip, mypy sạch |
| 2026-10-20 18:20 | P6 | start | worktree ../mtl-wt/p6, branch feat/p6-export-glossary-polish, pane w1H:pA, agent cook-p6; giao thêm unique index glossary, tách chunk editor, chapter.export |
| 2026-10-20 18:46 | P6 | done | cook-p6 báo DONE_WITH_CONCERNS (API 115, web 52, worker 120, e2e 6/6). Đã làm thêm: unique glossary (migration 0002 + down), tách chunk editor 907→437 kB, export server-side. Chưa kiểm: parity box xoay, parity trên runner Linux; owner soi mắt 5 trang, export 100 trang thật, mở CBZ YACReader/Komga. P7: rule tự xoá export 7 ngày trên bucket |
| 2026-10-20 18:47 | P6 | merge | Kiểm lại worktree xanh → merge --no-ff không conflict. Main: typecheck/lint/test xanh, worker pytest 120+2 skip, ruff/mypy sạch |
