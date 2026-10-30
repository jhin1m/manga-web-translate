ALTER TABLE "chapters" ADD COLUMN "run_target" text;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "run_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "run_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "translate_queued" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_run_target_chk" CHECK ("chapters"."run_target" IS NULL OR "chapters"."run_target" IN ('prepared','translated'));