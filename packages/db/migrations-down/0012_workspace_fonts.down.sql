-- Down thủ công cho 0012_workspace_fonts.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0012_workspace_fonts.down.sql
-- Series đang trỏ font tuỳ chỉnh (default_fonts = "custom-…") sẽ không còn font: web/worker fallback font mặc định.
BEGIN;
DROP TABLE IF EXISTS workspace_fonts;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
