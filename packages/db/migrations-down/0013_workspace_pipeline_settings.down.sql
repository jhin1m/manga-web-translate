-- Down thủ công cho 0013_workspace_pipeline_settings.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0013_workspace_pipeline_settings.down.sql
BEGIN;
ALTER TABLE workspace_settings DROP COLUMN IF EXISTS pipeline;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
