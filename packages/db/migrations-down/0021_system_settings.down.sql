-- Down thủ công cho 0021_system_settings (user_settings không bị đụng nên bản cũ đọc lại được).
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0021_system_settings.down.sql
BEGIN;
DROP TABLE IF EXISTS system_settings;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
