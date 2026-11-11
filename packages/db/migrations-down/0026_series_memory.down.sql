-- Down thủ công cho 0026_series_memory (mất gợi ý series chờ duyệt + trí nhớ dịch của chương; glossary/quy tắc xưng hô đã Nhận giữ nguyên).
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0026_series_memory.down.sql
BEGIN;
DROP TABLE IF EXISTS series_suggestions;
ALTER TABLE chapters DROP COLUMN IF EXISTS translate_memory;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
