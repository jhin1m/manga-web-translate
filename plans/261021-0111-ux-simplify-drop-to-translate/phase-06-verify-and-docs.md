# Phase 6 — Kiểm thử toàn luồng với chương mẫu + docs

Status: Pending · Branch: `feat/ux-p6-verify` · Context: [plan.md](./plan.md)

## Yêu cầu
- Restart worker local để nạp code P5 (chỉ process `mtl-worker --api http://localhost:8787` do owner chạy; khởi động lại đúng lệnh cũ, trong pane riêng, xem `docs/job-queue-worker.md`). Không đụng process khác.
- Dùng Chrome (claude-in-chrome) chạy luồng thật trên `http://localhost:5180` với `/Users/jhin1m/Downloads/demo_manga_eng/*.webp`: thả ở home → tự tạo + tự dịch → đợi xong → kiểm từng tiêu chí chấp nhận trong `plan.md`, chụp màn hình bằng chứng (lưu scratchpad), đổi số chương trên header, xuất ZIP.
- Lỗi phát hiện: sửa ngay nếu nhỏ và rõ (commit riêng trên branch này, có test); lỗi lớn → ghi report.
- Toàn bộ: `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @mtl/web e2e`.
- Docs: `docs/development-setup.md`, `docs/editor.md`, `docs/design-guidelines.md` khớp hành vi mới (đọc trước khi sửa, chỉ sửa đoạn liên quan).
- Report: `plans/reports/verify-261021-ux-simplify-drop-to-translate-report.md` — tiêu chí đạt/chưa, ảnh bằng chứng (đường dẫn), vấn đề còn mở.
