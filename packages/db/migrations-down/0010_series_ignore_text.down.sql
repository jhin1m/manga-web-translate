-- Down thủ công cho 0010_series_ignore_text.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0010_series_ignore_text.down.sql
BEGIN;
ALTER TABLE series DROP COLUMN IF EXISTS ignore_text;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
