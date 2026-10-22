ALTER TABLE "source_files" ADD COLUMN "skip" text;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_skip_chk" CHECK ("source_files"."skip" in ('user', 'credit'));