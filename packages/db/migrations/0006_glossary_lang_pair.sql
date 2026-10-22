ALTER TABLE "glossary_entries" ADD COLUMN "source_lang" text;--> statement-breakpoint
ALTER TABLE "glossary_entries" ADD COLUMN "target_lang" text;--> statement-breakpoint
-- Trước 0.4.0 API chỉ cho ko→vi → mọi entry chung hiện có viết cho ko→vi. Entry series giữ NULL/NULL.
UPDATE "glossary_entries" SET "source_lang" = 'ko', "target_lang" = 'vi' WHERE "series_id" IS NULL;--> statement-breakpoint
ALTER TABLE "glossary_entries" DROP CONSTRAINT "glossary_entries_scope_term_uq";--> statement-breakpoint
ALTER TABLE "glossary_entries" ADD CONSTRAINT "glossary_entries_scope_term_uq" UNIQUE NULLS NOT DISTINCT("workspace_id","series_id","source_lang","target_lang","source_term");--> statement-breakpoint
-- Series khác ko→vi mất entry chung ko→vi → glossary hiệu lực đổi; tăng rev để "Dịch lại" không trùng key job cũ.
UPDATE "series" SET "glossary_rev" = "glossary_rev" + 1
WHERE ("source_lang", "target_lang") IS DISTINCT FROM ('ko', 'vi')
  AND EXISTS (
    SELECT 1 FROM "glossary_entries" g
    WHERE g."workspace_id" = "series"."workspace_id" AND g."series_id" IS NULL
  );
