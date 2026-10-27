-- Down thủ công cho 0015_single_user_guard_worker_kind.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0015_single_user_guard_worker_kind.down.sql
BEGIN;
ALTER TABLE worker_tokens DROP CONSTRAINT IF EXISTS worker_tokens_kind_chk;
ALTER TABLE worker_tokens DROP COLUMN IF EXISTS kind;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
