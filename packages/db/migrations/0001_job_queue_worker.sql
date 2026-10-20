CREATE TABLE "runtime_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "worker_id" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "output_rev" integer;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "prepare_partial" jsonb;--> statement-breakpoint
CREATE INDEX "jobs_running_lease_idx" ON "jobs" USING btree ("lease_expires_at") WHERE "jobs"."status" = 'running';