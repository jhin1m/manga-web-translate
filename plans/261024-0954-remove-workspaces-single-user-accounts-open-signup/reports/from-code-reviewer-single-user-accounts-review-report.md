# Code review — single-user accounts (24/10/2026)

Điểm: 8/10. Critical: 0. Không mất điều kiện lọc tenant nào; 401 mọi route; 55 ca chéo user + meta-test.

## Đã sửa sau review
- M1 cache lẫn tài khoản cùng tab sau khi đăng nhập lại → `queryClient.clear()` sau `signIn` (`routes/login.tsx`).
- L1 `chapterSummary.locked_by` lộ holder `${userId}:${tabId}` → `locked: boolean` (API + type web).
- L2 type `lockChapter` còn `holder` → `{ expires_at }`.
- L3 `PUT /api/settings/pipeline` update-rồi-insert đua nhau → upsert `onConflictDoUpdate`.
- L5 comment cũ `editor/store.ts`. L7 thêm test `api()` gửi `x-tab-id`.

## Chưa sửa (cần quyết định)
- **H1** Job không-LLM (ingest/prepare OCR local, reinpaint, export) của user vượt hạn mức khi không có Mac sống: Modal
  không nhận → chờ tới 00:00 UTC, chương `processing`. Plan phase 2 đã chấp nhận ở Risk nhưng mâu thuẫn tiêu chí "không
  kẹt". Lựa chọn: (a) giữ; (b) 402 ở các endpoint đó khi vượt + không Mac sống; (c) chỉ hiện chữ "đang chờ" trên UI.
- **M2** Tab crash (không kịp `pagehide`) → chính chủ bị khoá tới 15'. Gợi ý: nút "Lấy quyền sửa ở tab này" cướp khoá
  khi holder cùng `userId`.
- **M3** Hàng đợi chung không công bằng theo user (FIFO `priority, created_at`) — 1 user batch lớn làm chậm người khác.
  Cần quyết trước khi bật đăng ký ở production.
- L4 lỗi quota lưu `error_class=internal` + tiền tố `quota_exceeded` (không đổi check constraint/hợp đồng worker); câu
  lỗi job không kèm "$x / $y" (402 thì có).
- L6 `.env.example` bật `SIGNUP_ENABLED=true` cho dev; `infra/smoke.sh` chặn deploy production khi lỡ bật.
- L8 không commit `.claude/`.
