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
