ALTER TABLE "chapters" ADD COLUMN "ingest_mode" text DEFAULT 'strip' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "page_format" text DEFAULT 'strip' NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_ingest_mode_chk" CHECK ("chapters"."ingest_mode" in ('strip', 'pages'));--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_page_format_chk" CHECK ("series"."page_format" in ('strip', 'pages'));--> statement-breakpoint
-- Backfill: series manga Nhật mặc định từng trang, còn lại giữ strip. Chương cũ giữ 'strip' (web chưa từng gửi mode).
UPDATE "series" SET "page_format" = 'pages' WHERE "source_lang" = 'ja';
