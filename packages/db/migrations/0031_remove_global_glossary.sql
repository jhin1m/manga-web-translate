-- Bỏ glossary chung (series_id NULL, theo cặp source_lang/target_lang). Chép mỗi entry chung vào mọi series cùng người
-- dùng, cùng cặp nguồn→đích mà series chưa có term đó (khớp chính xác như unique cũ) → entry series vẫn thắng như khi
-- còn gộp, glossary hiệu lực của mỗi series không đổi nên không tăng glossary_rev. Id sinh bằng gen_random_uuid() (app
-- dùng v7, không phụ thuộc thứ tự id).
-- Entry chung không chép được vào series nào (người dùng chưa có series cùng cặp, hoặc cặp NULL do bản API cũ ghi trong
-- cửa sổ rollback 0006) chuyển nguyên vào glossary_global_archive (giữ id) thay vì mất; file down trả chúng về
-- glossary_entries. Entry chung có series cùng cặp nhưng series nào cũng đã có term đó thì chưa từng có hiệu lực → xoá.
CREATE TABLE "glossary_global_archive" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"source_lang" text,
	"target_lang" text,
	"source_term" text NOT NULL,
	"target_term" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"case_sensitive" boolean DEFAULT false NOT NULL,
	"origin" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "glossary_global_archive" ADD CONSTRAINT "glossary_global_archive_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "glossary_entries" ("id", "user_id", "series_id", "source_term", "target_term", "note", "case_sensitive", "origin", "created_at", "updated_at")
SELECT pg_catalog.gen_random_uuid(), g."user_id", s."id", g."source_term", g."target_term", g."note", g."case_sensitive", g."origin", g."created_at", g."updated_at"
FROM "glossary_entries" g
JOIN "series" s ON s."user_id" = g."user_id" AND s."source_lang" = g."source_lang" AND s."target_lang" = g."target_lang"
WHERE g."series_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "glossary_entries" e WHERE e."series_id" = s."id" AND e."source_term" = g."source_term"
  );--> statement-breakpoint
INSERT INTO "glossary_global_archive" ("id", "user_id", "source_lang", "target_lang", "source_term", "target_term", "note", "case_sensitive", "origin", "created_at", "updated_at")
SELECT g."id", g."user_id", g."source_lang", g."target_lang", g."source_term", g."target_term", g."note", g."case_sensitive", g."origin", g."created_at", g."updated_at"
FROM "glossary_entries" g
WHERE g."series_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "series" s
    WHERE s."user_id" = g."user_id" AND s."source_lang" = g."source_lang" AND s."target_lang" = g."target_lang"
  );--> statement-breakpoint
DELETE FROM "glossary_entries" WHERE "series_id" IS NULL;--> statement-breakpoint
ALTER TABLE "glossary_entries" DROP CONSTRAINT "glossary_entries_scope_term_uq";--> statement-breakpoint
DROP INDEX "glossary_user_series_idx";--> statement-breakpoint
ALTER TABLE "glossary_entries" ALTER COLUMN "series_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "glossary_entries" DROP COLUMN "source_lang";--> statement-breakpoint
ALTER TABLE "glossary_entries" DROP COLUMN "target_lang";--> statement-breakpoint
ALTER TABLE "glossary_entries" ADD CONSTRAINT "glossary_entries_scope_term_uq" UNIQUE("user_id","series_id","source_term");
