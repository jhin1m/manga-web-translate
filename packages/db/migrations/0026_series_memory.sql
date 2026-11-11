CREATE TABLE "series_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"data" jsonb NOT NULL,
	"chapter_id" uuid,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_suggestions_series_kind_key_uq" UNIQUE("series_id","kind","key"),
	CONSTRAINT "series_suggestions_kind_chk" CHECK ("series_suggestions"."kind" in ('term', 'pronoun'))
);
--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "translate_memory" jsonb;--> statement-breakpoint
ALTER TABLE "series_suggestions" ADD CONSTRAINT "series_suggestions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_suggestions" ADD CONSTRAINT "series_suggestions_user_id_series_id_series_user_id_id_fk" FOREIGN KEY ("user_id","series_id") REFERENCES "public"."series"("user_id","id") ON DELETE cascade ON UPDATE no action;