-- Down thủ công cho 0008_page_skipped.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0008_page_skipped.down.sql
BEGIN;
ALTER TABLE pages DROP COLUMN IF EXISTS skipped;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
