-- Down thủ công cho 0029_series_cover_key (bỏ ảnh bìa tuỳ chỉnh; chỉ mất cột trỏ tới bìa).
-- Object bìa vẫn nằm trong storage dưới u/<user>/series/<series>/cover/ — dọn tay nếu cần.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0029_series_cover_key.down.sql
BEGIN;
ALTER TABLE series DROP COLUMN IF EXISTS cover_key;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
