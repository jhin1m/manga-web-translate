-- Down thủ công cho 0025_system_fonts (series / text box đang trỏ font hệ thống sẽ fallback font mặc định; object ở system/fonts/ giữ lại).
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0025_system_fonts.down.sql
BEGIN;
DROP TABLE IF EXISTS system_fonts;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
