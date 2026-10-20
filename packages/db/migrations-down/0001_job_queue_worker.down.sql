-- Down thủ công cho 0001_job_queue_worker (bảng/cột thêm cho hàng đợi job + worker protocol).
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0001_job_queue_worker.down.sql
BEGIN;
DROP INDEX IF EXISTS jobs_running_lease_idx;
ALTER TABLE pages DROP COLUMN IF EXISTS prepare_partial;
ALTER TABLE jobs DROP COLUMN IF EXISTS output_rev, DROP COLUMN IF EXISTS worker_id, DROP COLUMN IF EXISTS claimed_at;
DROP TABLE IF EXISTS runtime_flags;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
