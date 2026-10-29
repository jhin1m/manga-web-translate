-- Down thủ công cho 0019_jobs_progress_counts.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0019_jobs_progress_counts.down.sql
BEGIN;
ALTER TABLE jobs DROP COLUMN IF EXISTS progress_done, DROP COLUMN IF EXISTS progress_total;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
