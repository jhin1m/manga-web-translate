-- Down thủ công cho 0005_series_page_format.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0005_series_page_format.down.sql
BEGIN;
ALTER TABLE series DROP CONSTRAINT IF EXISTS series_page_format_chk;
ALTER TABLE series DROP COLUMN IF EXISTS page_format;
ALTER TABLE chapters DROP CONSTRAINT IF EXISTS chapters_ingest_mode_chk;
ALTER TABLE chapters DROP COLUMN IF EXISTS ingest_mode;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
