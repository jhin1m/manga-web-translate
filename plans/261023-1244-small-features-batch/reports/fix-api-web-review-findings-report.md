# Sửa các phát hiện code review (API + web)

Ngày: 2026-10-23 · Nhánh `feat/small-features-batch` (chưa commit). Không đụng H1 (`packages/shared/src/ignore-text.ts`), worker, font.

## Đã sửa
- **Resume upload sau khi đổi thứ tự (H2)**: `upload-manager.ts` `resumeChapter` sắp `source_files` theo `id` thay vì `ord`.
  Xác minh: `POST /chapters` insert tuần tự theo thứ tự khai báo, `id` do `idPk()` sinh bằng `uuidv7()` (monotonic cùng ms) →
  sắp theo id = thứ tự khai báo. Thêm test "resume matches dropped files by creation order…".
- **Đổi thứ tự nhanh (M1)**: mutation reorder có `scope` theo chương (chạy nối tiếp); `onSuccess` ghi thứ tự server trả về khi là
  lần đổi mới nhất.
- **L4**: `moveTo` trong `source-rail.tsx` không đặt `refocus` khi không đổi chỗ thật (đầu/cuối).
- **L5**: rollback hoàn lại riêng từng cache (danh sách ảnh và chi tiết chương) theo thứ tự của chính cache đó.
- **Báo gửi mail (M2)**: API chạy một tiến trình (`mtl-api` một unit systemd, `docs/deployment-guide.md`) nên map trong bộ
  nhớ là đủ. `lib/invite-mail-status.ts` (tối đa 500 mục, bỏ mục cũ nhất) ghi kết quả gửi theo invitation id trong
  `sendInvitationEmail`; `GET …/invitations/:id/link` trả thêm `mail_sent` (true/false/null). Web: đã gửi → "Đã gửi email…";
  gửi lỗi → "gửi email không thành công, gửi link này"; null (API vừa restart) → "chưa xác nhận được email đã gửi". Không cần
  cột DB; mất khi restart chỉ làm câu thận trọng hơn. Nút "Gửi lại email" giữ nguyên (còn hữu ích khi gửi lỗi).
- **L1**: `describeMailError` không bao giờ ném lỗi (giải mã `%` hỏng thì chỉ che dạng thô; che cả dạng thô lẫn đã giải mã). Test mới.
- **L8**: vai trò trong mail dịch sang tiếng Việt (thành viên / quản trị viên / chủ sở hữu). Test mới.
- **M3**: hint regex bọc trong chuỗi JS để hiển thị đúng `/discord\s*\.\s*gg/`.
- **Áp ngược theo series (M4, L2, L3)** `routes/series-ignore-apply.ts`:
  - Mỗi chương một transaction: `lockChapter` (FOR UPDATE) → kiểm người giữ khoá + job đang chạy ngay trong transaction → `applyBatch`/`undoBatch`.
    Không còn lấy/nhả khoá chương, nên không thể nhả nhầm khoá của editor đang mở và không dùng dữ liệu cũ của đầu request.
  - Apply chỉ đọc state chương có trang trong `versions` (một lần trong tx của chương). Chương bị chặn không có trong `versions` chỉ
    đọc state để báo `skipped` nếu còn chữ cần ẩn (giữ nguyên hợp đồng cũ).
  - Undo đọc lịch sử theo từng chương (`chapterBatchHistory`, mới trong `lib/batch-edit.ts`, `undoBatch` dùng chung) thay vì nạp
    cả batch; bỏ qua chương có job chạy (`busy`); chỉ nhận batch do ignore-apply tạo (nếu không → 410 `batch_not_found`).
  - Nguồn gốc batch: không có cột riêng; dùng `actor` của lịch sử (`user:<id>#ignore-text`, `applyBatch` nhận tham số `tag`).
    `actor` là chuỗi tự do, không nơi nào phân tích. Batch ignore-apply cũ (trước thay đổi này, chưa phát hành) sẽ bị từ chối khi undo.
  - Test mới: undo bỏ qua chương có job, undo từ chối batch find/replace, apply không nhả khoá editor.
- **L6**: `docs/job-queue-worker.md` thêm ghi chú mục cũ `/…/` thành regex, mục < 3 ký tự sau bỏ khoảng trắng không hợp lệ.
  Lỗi theo dòng đã có sẵn ở form (`parseIgnoreText` → "Dòng N: …", nút Lưu bị khoá); server trả 400 kèm lý do.
- **L7**: `routes/pages.ts` dùng `tx.update(pages).set({ skipChangedAt: sql\`now()\` })` (đúng kiểu `queue.ts`/`reaper.ts`), bỏ ép kiểu.

## Kiểm tra
- `pnpm --filter @mtl/api test`: 234/234. `@mtl/web test`: 191/191. `@mtl/shared test`: 29/29.
- `pnpm typecheck` sạch; `pnpm lint` sạch (đã `biome check --write` các file đụng tới).
- Playwright `upload-chapter` + `series-manage`: 10/10. Không có e2e riêng cho workspaces/invite.

## Lưu ý
- Hành vi apply thay đổi nhỏ: trang có khớp mới xuất hiện sau preview trong chương không có trong `versions` không còn bị báo
  "changed" (chương không nằm trong lần xem). Trang trong chương đã xem vẫn bị 409 → "changed".
- Biome `--write` chạy trên cả thư mục `apps/api/src/routes` nhưng lint trước đó chỉ báo 2 lỗi (của file tôi sửa) nên không file khác bị format.

Status: DONE
Summary: Đã sửa H2, M1, M2, M3, M4, L1–L8 (trừ H1 theo yêu cầu); test api/web/shared, typecheck, lint, e2e liên quan đều xanh.
Concerns/Blockers: Batch ignore-apply tạo trước thay đổi này không undo được (chưa phát hành, nhưng DB dev có thể có). Không có e2e cho màn mời thành viên.
