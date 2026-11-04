CREATE TABLE "system_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"pipeline" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_daily_usd" numeric,
	"global_daily_usd" numeric,
	"signup_enabled" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_settings_singleton_chk" CHECK ("system_settings"."id" = 1)
);
--> statement-breakpoint
INSERT INTO "system_settings" ("id", "pipeline")
SELECT 1, "pipeline" FROM "user_settings" ORDER BY "updated_at" DESC LIMIT 1
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "system_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
