-- Down thủ công cho 0014_proofread_suggestions.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0014_proofread_suggestions.down.sql
-- Job chapter.proofread còn trong bảng jobs phải xoá trước khi khôi phục check constraint cũ.
BEGIN;
DROP TABLE IF EXISTS proofread_suggestions;
DELETE FROM jobs WHERE type = 'chapter.proofread';
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_chk;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_chk CHECK (type in ('chapter.ingest', 'page.prepare', 'chapter.translate', 'page.reinpaint', 'page.ocr_region', 'chapter.export'));
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
