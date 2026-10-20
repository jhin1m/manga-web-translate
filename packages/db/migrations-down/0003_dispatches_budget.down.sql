-- Down thủ công cho 0003_dispatches_budget (dòng ledger gpu_idle_seconds theo dispatch mất liên kết dispatch).
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0003_dispatches_budget.down.sql
BEGIN;
DROP INDEX IF EXISTS usage_ledger_created_idx;
DROP INDEX IF EXISTS usage_ledger_dispatch_kind_uq;
ALTER TABLE usage_ledger DROP CONSTRAINT IF EXISTS usage_ledger_dispatch_id_dispatches_id_fk;
ALTER TABLE usage_ledger DROP COLUMN IF EXISTS dispatch_id;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_dispatch_id_dispatches_id_fk;
DROP TABLE IF EXISTS dispatches;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
