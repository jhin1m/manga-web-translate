-- Down thủ công cho 0030_auto_apply_series_memory (mất nhãn AI của entry glossary và Giọng văn; nội dung giữ nguyên).
-- Khoá sổ series_suggestions bỏ tiền tố cặp ngôn ngữ "{src}>{tgt}|" để khớp lại khoá API cũ tính. Series đã đổi cặp
-- ngôn ngữ có thể có hai khoá trùng sau khi bỏ tiền tố (unique series_id, kind, key): giữ dòng cũ nhất, xoá dòng còn lại.
-- Nhãn AI của cặp xưng hô nằm trong JSON pronoun_rules (`origin`) và file này không dọn: API cũ đưa nguyên
-- pronoun_rules vào prompt (JSON.stringify) nên `"origin":"ai"` lọt vào prompt dịch sau khi về API cũ.
-- Về API cũ, dòng sổ chưa Bỏ hiện lại thành gợi ý chờ duyệt. Chạy API cũ khi chưa chạy file này (khoá còn tiền tố)
-- thì hiện cả mục đang có trong glossary / pronoun_rules, bấm Nhận ra 409. Chạy file này rồi thì mục đã có bị ẩn, còn
-- mục AI người dùng đã xoá thì hiện lại.
-- Chạy: psql "$DATABASE_URL" -f packages/db/migrations-down/0030_auto_apply_series_memory.down.sql
BEGIN;
DELETE FROM series_suggestions a
  USING series_suggestions b
  WHERE a.series_id = b.series_id
    AND a.kind = b.kind
    AND a.id <> b.id
    AND regexp_replace(a.key, '^[^>|]+>[^>|]+\|', '') = regexp_replace(b.key, '^[^>|]+>[^>|]+\|', '')
    AND (a.created_at, a.id) > (b.created_at, b.id);
UPDATE series_suggestions SET key = regexp_replace(key, '^[^>|]+>[^>|]+\|', '') WHERE key ~ '^[^>|]+>[^>|]+\|';
ALTER TABLE series DROP CONSTRAINT IF EXISTS series_style_origin_chk;
ALTER TABLE glossary_entries DROP CONSTRAINT IF EXISTS glossary_entries_origin_chk;
ALTER TABLE series DROP COLUMN IF EXISTS style_origin;
ALTER TABLE glossary_entries DROP COLUMN IF EXISTS origin;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
COMMIT;
