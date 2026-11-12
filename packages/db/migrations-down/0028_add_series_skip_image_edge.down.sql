-- Down thủ công cho 0028_add_series_skip_image_edge (xoá các dải mép đã học; ảnh credit cả tấm giữ nguyên).
-- Thumbnail của dải vẫn nằm trong storage dưới u/<user>/series/<series>/ — dọn tay nếu cần.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0028_add_series_skip_image_edge.down.sql
BEGIN;
DELETE FROM series_skip_images WHERE edge IS NOT NULL;
ALTER TABLE series_skip_images DROP CONSTRAINT IF EXISTS series_skip_images_edge_chk;
ALTER TABLE series_skip_images DROP COLUMN IF EXISTS edge;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
