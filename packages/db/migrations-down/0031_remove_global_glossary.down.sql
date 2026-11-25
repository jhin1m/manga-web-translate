-- Down thủ công cho 0031_remove_global_glossary: thêm lại cột source_lang / target_lang (nullable), series_id nullable,
-- unique cũ theo phạm vi (series hoặc cặp ngôn ngữ), index (user_id, series_id); trả entry trong glossary_global_archive
-- về glossary chung (series_id NULL, đúng cặp, giữ id) rồi xoá bảng lưu trữ. Entry chung đã được chép thành entry riêng
-- của từng series lúc up thì giữ nguyên như vậy (bản API cũ thấy chúng là entry series bình thường), không trở lại
-- trang Glossary chung. Chạy file này TRƯỚC khi lùi app về bản còn glossary chung — bản cũ đọc / ghi hai cột trên nên
-- lỗi khi thiếu cột.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0031_remove_global_glossary.down.sql
BEGIN;
ALTER TABLE glossary_entries DROP CONSTRAINT IF EXISTS glossary_entries_scope_term_uq;
ALTER TABLE glossary_entries ALTER COLUMN series_id DROP NOT NULL;
ALTER TABLE glossary_entries ADD COLUMN IF NOT EXISTS source_lang text;
ALTER TABLE glossary_entries ADD COLUMN IF NOT EXISTS target_lang text;
ALTER TABLE glossary_entries ADD CONSTRAINT glossary_entries_scope_term_uq
  UNIQUE NULLS NOT DISTINCT (user_id, series_id, source_lang, target_lang, source_term);
CREATE INDEX IF NOT EXISTS glossary_user_series_idx ON glossary_entries USING btree (user_id, series_id);
INSERT INTO glossary_entries (id, user_id, series_id, source_lang, target_lang, source_term, target_term, note,
  case_sensitive, origin, created_at, updated_at)
SELECT id, user_id, NULL, source_lang, target_lang, source_term, target_term, note, case_sensitive, origin, created_at,
  updated_at
FROM glossary_global_archive;
DROP TABLE glossary_global_archive;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
