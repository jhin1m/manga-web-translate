-- Down thủ công cho 0024_user_disabled_at (bản API trước đó không đọc cột; user đang bị khoá sẽ đăng nhập lại được).
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0024_user_disabled_at.down.sql
BEGIN;
ALTER TABLE "user" DROP COLUMN IF EXISTS "disabled_at";
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
