-- Down thủ công cho 0000_init (drizzle không có down). Chỉ dùng ở dev/khôi phục: xoá toàn bộ dữ liệu.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0000_init.down.sql  (docker: docker exec -i mtl-dev-postgres-1 psql -U mtl -d mtl < …)
BEGIN;
DROP TABLE IF EXISTS
  usage_ledger, jobs, worker_tokens, glossary_entries, page_state_history, page_states, pages,
  source_files, chapters, series, workspace_settings,
  invitation, member, organization, verification, account, session, "user"
  CASCADE;
DROP TABLE IF EXISTS drizzle.__drizzle_migrations;
COMMIT;
