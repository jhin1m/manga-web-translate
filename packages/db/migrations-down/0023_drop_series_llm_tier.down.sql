-- Down thủ công cho 0023_drop_series_llm_tier (khôi phục cột; API bản trước 0.10.0 đọc cột này).
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0023_drop_series_llm_tier.down.sql
BEGIN;
ALTER TABLE series ADD COLUMN IF NOT EXISTS llm_tier text DEFAULT 'default' NOT NULL;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
