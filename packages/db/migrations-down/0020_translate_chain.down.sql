-- Down thủ công cho 0020_translate_chain.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0020_translate_chain.down.sql
BEGIN;
ALTER TABLE chapters DROP CONSTRAINT IF EXISTS chapters_run_target_chk;
ALTER TABLE chapters DROP COLUMN IF EXISTS run_target, DROP COLUMN IF EXISTS run_started_at,
  DROP COLUMN IF EXISTS run_total;
ALTER TABLE pages DROP COLUMN IF EXISTS translate_queued;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
