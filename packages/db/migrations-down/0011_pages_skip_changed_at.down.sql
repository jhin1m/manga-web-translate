-- Down thủ công cho 0011_pages_skip_changed_at.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0011_pages_skip_changed_at.down.sql
BEGIN;
ALTER TABLE pages DROP COLUMN IF EXISTS skip_changed_at;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
