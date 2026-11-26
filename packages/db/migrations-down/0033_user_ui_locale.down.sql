-- Down thủ công cho 0033_user_ui_locale: bỏ cột ngôn ngữ giao diện của user (mất lựa chọn đã đồng bộ; web gửi lại khi
-- mở bản mới). Chạy TRƯỚC khi lùi app về bản chưa có cột — app cũ không đọc cột này nhưng chốt schema lúc boot thấy DB
-- mới hơn image sẽ dừng khởi động.
-- Job dịch / hiệu đính chưa xong (đang chờ, chờ ngân sách, hoặc đang chạy — hết lease thì xếp lại) bỏ `ui_lang` khỏi
-- payload: schema payload của worker < 0.14.0 cấm trường lạ, để nguyên thì job fail khi worker cũ nhận.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0033_user_ui_locale.down.sql
BEGIN;
UPDATE jobs SET payload = payload - 'ui_lang'
WHERE type IN ('chapter.translate', 'chapter.proofread')
  AND status IN ('queued', 'running', 'paused_budget')
  AND payload ? 'ui_lang';
ALTER TABLE "user" DROP COLUMN IF EXISTS ui_locale;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
