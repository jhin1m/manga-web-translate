-- Down thủ công cho 0007_source_file_skip.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0007_source_file_skip.down.sql
BEGIN;
ALTER TABLE source_files DROP CONSTRAINT IF EXISTS source_files_skip_chk;
ALTER TABLE source_files DROP COLUMN IF EXISTS skip;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
