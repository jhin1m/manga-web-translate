# Phase 3 — Gom trạng thái về 1 chỗ: report

Branch `feat/ux-p3-status` (từ main `4e0b29a`), chưa merge, chưa push. Commit: `6472d5b` feat(web), `9c39f8e` docs, + commit plan/report.

## Kiểm chứng (21/10/2026)
- `pnpm typecheck`: web/api/db Done.
- `pnpm lint`: Checked 236 files, no fixes.
- `pnpm test`: shared 8, web 127 (22 files), db 3, api 144 — all passed.
- `pnpm --filter @mtl/web e2e` (toàn bộ): 16 passed (chapter-tools 3, click-budget, editor 7, full-flow, routes-redirect, typeset-parity, upload-chapter 2).
- Thủ công qua headless Chromium trên dev 5180: chương review → topbar "Chương 5 · Chờ duyệt · [khoá] Đã lưu | Gốc/Dịch/Chia đôi | Dịch lại ▾ | icon Hoạt động | ? | Xuất", không băng; chương nháp → "Nháp", nút "Dịch chương", không băng; không lỗi console. Tab thứ 2/khoá bị từ chối: phủ bằng e2e (route 423) thay vì 2 user thật.

## Quyết định tự chốt
1. Nút primary lúc ingesting/processing = "Xuất" disabled (title giải thích) thay vì "Đang dịch x/y" — bỏ trùng với chip. `PrimaryAction.command` không còn `null`.
2. "Hoạt động" + "?" thành icon nhỏ (plan cho phép "hoặc icon nhỏ") thay vì menu "⋯": giữ badge số việc nhìn thấy được, 1 click.
3. Thông báo khôi phục phiên chuyển từ Notices vào băng cảnh báo (cùng nhóm "phải làm gì").
4. Chip đổi nhãn: "Nháp" (thay "Nháp (chưa commit)"), "Đang tải ảnh d/t", "Tải dở d/t ảnh", "Đang dịch r/n", "Chờ duyệt · k cần xem" (tone warn khi k>0), "Lỗi f trang", "Cắt trang lỗi", "Xong". `CHAPTER_STATUS` cũ giữ nguyên (không còn dùng ở màn chương; chưa xoá vì không đụng phạm vi khác).
5. Notice "ảnh bị loại" ẩn khi chương đã qua trạng thái chưa ổn định rồi ổn định lại (tránh ẩn ngay vì status cache còn `draft`/`partial_failed` lúc nhận response).
6. Chỉ báo khoá: chữ đầy đủ "Bạn đang giữ khoá chương"/"Đang dịch — sửa được khi xong" nằm trong sr-only + title → selector e2e `getByRole("status", { name: "Khoá chương" })` giữ nguyên ngữ nghĩa.

## Vấn đề còn mở
- Script chụp màn hình đã gọi `DELETE /lock` cho các chương gần đây của workspace dev (để không giữ khoá sau khi đóng headless). Nếu owner đang mở chương ở tab khác, heartbeat sẽ lấy lại khoá; không ảnh hưởng dữ liệu.
- Cảnh báo "Several Konva instances detected" ở typeset-parity e2e có từ trước, ngoài phạm vi.
- Bề ngang nền nhãn "Đang dịch…" trên PageSlot ước theo số ký tự (0.6em/ký tự), không đo thật — đủ cho 2 nhãn cố định hiện có.
- Phase 4 sẽ sửa tiếp `chapter-topbar.tsx` (sửa series/số chương trên header): chỗ trống cạnh chip đã gọn hơn.
