-- Down thủ công cho 0006_glossary_lang_pair. Term trùng giữa các cặp trong cùng phạm vi chỉ giữ một bản: ưu tiên ko→vi
-- (up lại sẽ gán mọi entry chung còn lại = ko→vi), không có thì bản sửa gần nhất. glossary_rev đã tăng không hoàn lại.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0006_glossary_lang_pair.down.sql
BEGIN;
ALTER TABLE glossary_entries DROP CONSTRAINT IF EXISTS glossary_entries_scope_term_uq;
DELETE FROM glossary_entries g
USING glossary_entries newer
WHERE g.workspace_id = newer.workspace_id
  AND g.series_id IS NOT DISTINCT FROM newer.series_id
  AND g.source_term = newer.source_term
  AND (g.source_lang = 'ko' AND g.target_lang = 'vi', g.updated_at, g.id)
    < (newer.source_lang = 'ko' AND newer.target_lang = 'vi', newer.updated_at, newer.id);
ALTER TABLE glossary_entries ADD CONSTRAINT glossary_entries_scope_term_uq
  UNIQUE NULLS NOT DISTINCT (workspace_id, series_id, source_term);
ALTER TABLE glossary_entries DROP COLUMN IF EXISTS source_lang;
ALTER TABLE glossary_entries DROP COLUMN IF EXISTS target_lang;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
