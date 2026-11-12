-- Down thủ công cho 0027_add_source_file_trim (mất số px cắt mép đã lưu; ảnh gốc không đổi).
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0027_add_source_file_trim.down.sql
BEGIN;
ALTER TABLE source_files DROP CONSTRAINT IF EXISTS source_files_trim_chk;
ALTER TABLE source_files DROP COLUMN IF EXISTS "trim";
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
