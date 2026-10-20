-- Down thủ công cho 0002_glossary_term_unique (bản ghi trùng đã xoá lúc up không khôi phục được).
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0002_glossary_term_unique.down.sql
BEGIN;
ALTER TABLE glossary_entries DROP CONSTRAINT IF EXISTS glossary_entries_scope_term_uq;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
