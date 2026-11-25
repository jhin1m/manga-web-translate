-- Down thủ công cho 0032_drop_system_settings_limits: thêm lại 3 cột hạn mức / đăng ký của system_settings (nullable,
-- null = theo env như bản cũ). Giá trị đã lưu trước khi up không khôi phục được. Chạy file này TRƯỚC khi lùi app về bản
-- còn mục "Hạn mức & đăng ký" — bản cũ đọc / ghi 3 cột này nên lỗi khi thiếu cột.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0032_drop_system_settings_limits.down.sql
BEGIN;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS user_daily_usd numeric;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS global_daily_usd numeric;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS signup_enabled boolean;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
