# Phase 6 — Kiểm thử toàn luồng với chương mẫu + docs

Status: Pending · Branch: `feat/ux-p6-verify` · Context: [plan.md](./plan.md)

## Yêu cầu
- Restart worker local để nạp code P5 (chỉ process `mtl-worker --api http://localhost:8787` do owner chạy; khởi động lại đúng lệnh cũ, trong pane riêng, xem `docs/job-queue-worker.md`). Không đụng process khác.
- Dùng Chrome (claude-in-chrome) chạy luồng thật trên `http://localhost:5180` với `/Users/jhin1m/Downloads/demo_manga_eng/*.webp`: thả ở home → tự tạo + tự dịch → đợi xong → kiểm từng tiêu chí chấp nhận trong `plan.md`, chụp màn hình bằng chứng (lưu scratchpad), đổi số chương trên header, xuất ZIP.
- Lỗi phát hiện: sửa ngay nếu nhỏ và rõ (commit riêng trên branch này, có test); lỗi lớn → ghi report.
- Toàn bộ: `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @mtl/web e2e`.
- Docs: `docs/development-setup.md`, `docs/editor.md`, `docs/design-guidelines.md` khớp hành vi mới (đọc trước khi sửa, chỉ sửa đoạn liên quan).
- Report: `plans/reports/verify-261021-ux-simplify-drop-to-translate-report.md` — tiêu chí đạt/chưa, ảnh bằng chứng (đường dẫn), vấn đề còn mở.

## Cập nhật trước khi chạy (controller, 02:15 21/10)
- Worker đã được controller restart với code mới (herdr pane chạy `uv run mtl-worker --api http://localhost:8787 --provider gemini`) — **không** restart lại, không kill.
- Key Gemini free-tier đã hết quota hôm nay (429, reset ~14h). Luồng thật sẽ dừng ở bước OCR/dịch. Vì vậy:
  - Vẫn chạy luồng thả 5 ảnh → kiểm: tự tạo chương, tự commit, ingest + prepare (không cần Gemini) chạy, trang hiện ảnh gốc + "Đang dịch…", và khi translate lỗi 429 thì UI báo lỗi **rõ ràng, hiểu được** (chip/rail/thông báo), có đường thử lại. Nếu UI báo lỗi mù mờ → đó là lỗi UX cần sửa trong phase này (nhỏ, có test).
  - Tiêu chí về canvas/bảng/trạng thái/chỉ báo trang kiểm trên chương 5 (đã dịch sẵn) và chương 6 (do phase 4 tạo, đã dịch) của series "123".
  - Không đổi provider/key. Không tạo thêm chương thừa: dọn chương thử mà phase này tạo nếu không cần giữ (ghi lại trong report).
- Đã biết, không thuộc phạm vi: pane `pnpm jobs` in lỗi `relation "dispatches" does not exist` theo chu kỳ (bảng có trong DB `mtl`; nghi trùng thời điểm e2e reset DB) — chỉ ghi nhận nếu thấy thêm bằng chứng.
- Ghi nhận từ phase 5: trang 4 chương mẫu có khối chữ ngoài bóng chồng lên bóng thoại cạnh (hình học vùng đặt chữ) — chỉ ghi vào report, không sửa.
