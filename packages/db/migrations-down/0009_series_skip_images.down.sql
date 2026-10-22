-- Down thủ công cho 0009_series_skip_images.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0009_series_skip_images.down.sql
-- Object ảnh đã học (ws/{ws}/series/{id}/skip/) không bị xoá — dọn tay nếu cần.
BEGIN;
DROP TABLE IF EXISTS series_skip_images;
ALTER TABLE source_files DROP COLUMN IF EXISTS dhash;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
