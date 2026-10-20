CREATE TABLE "dispatches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_claim_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"lifetime_s" real,
	"busy_s" real,
	"note" text,
	CONSTRAINT "dispatches_status_chk" CHECK ("dispatches"."status" in ('pending', 'active', 'ended', 'no_claim'))
);
--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "dispatch_id" uuid;--> statement-breakpoint
CREATE INDEX "dispatches_open_idx" ON "dispatches" USING btree ("created_at") WHERE "dispatches"."status" in ('pending', 'active');--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_dispatch_id_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_dispatch_id_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_ledger_dispatch_kind_uq" ON "usage_ledger" USING btree ("dispatch_id","kind") WHERE "usage_ledger"."dispatch_id" is not null;--> statement-breakpoint
CREATE INDEX "usage_ledger_created_idx" ON "usage_ledger" USING btree ("created_at");