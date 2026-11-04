-- Down thủ công cho 0022_ai_providers (slot model, model, provider; key mã hoá mất cùng bảng).
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0022_ai_providers.down.sql
BEGIN;
ALTER TABLE system_settings
  DROP COLUMN IF EXISTS ocr_model_id,
  DROP COLUMN IF EXISTS translate_model_id,
  DROP COLUMN IF EXISTS proofread_model_id;
DROP TABLE IF EXISTS ai_models;
DROP TABLE IF EXISTS ai_providers;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
