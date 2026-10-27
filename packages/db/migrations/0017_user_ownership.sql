-- Dữ liệu thuộc thẳng user (bảng rỗng sau 0016). Unique (user_id, id) tạo trước FK kép trỏ vào nó.
CREATE TABLE "user_fonts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"font_id" text NOT NULL,
	"name" text NOT NULL,
	"file_key" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"units_per_em" integer NOT NULL,
	"ascent" integer NOT NULL,
	"descent" integer NOT NULL,
	"metrics_source" text NOT NULL,
	"vi_complete" boolean NOT NULL,
	"missing" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_fonts_font_id_unique" UNIQUE("font_id"),
	CONSTRAINT "user_fonts_user_sha_uq" UNIQUE("user_id","sha256")
);--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"pipeline" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "glossary_entries" DROP CONSTRAINT "glossary_entries_scope_term_uq";--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "glossary_entries" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "page_state_history" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "page_states" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "proofread_suggestions" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "series_skip_images" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "source_files" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_user_id_uq" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "glossary_entries" ADD CONSTRAINT "glossary_entries_scope_term_uq" UNIQUE NULLS NOT DISTINCT("user_id","series_id","source_lang","target_lang","source_term");--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_user_id_uq" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_user_id_uq" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "user_fonts" ADD CONSTRAINT "user_fonts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_user_id_series_id_series_user_id_id_fk" FOREIGN KEY ("user_id","series_id") REFERENCES "public"."series"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary_entries" ADD CONSTRAINT "glossary_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary_entries" ADD CONSTRAINT "glossary_entries_user_id_series_id_series_user_id_id_fk" FOREIGN KEY ("user_id","series_id") REFERENCES "public"."series"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_chapter_id_chapters_user_id_id_fk" FOREIGN KEY ("user_id","chapter_id") REFERENCES "public"."chapters"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_page_id_pages_user_id_id_fk" FOREIGN KEY ("user_id","page_id") REFERENCES "public"."pages"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_state_history" ADD CONSTRAINT "page_state_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_state_history" ADD CONSTRAINT "page_state_history_user_id_page_id_pages_user_id_id_fk" FOREIGN KEY ("user_id","page_id") REFERENCES "public"."pages"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_states" ADD CONSTRAINT "page_states_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_states" ADD CONSTRAINT "page_states_user_id_page_id_pages_user_id_id_fk" FOREIGN KEY ("user_id","page_id") REFERENCES "public"."pages"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_user_id_chapter_id_chapters_user_id_id_fk" FOREIGN KEY ("user_id","chapter_id") REFERENCES "public"."chapters"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofread_suggestions" ADD CONSTRAINT "proofread_suggestions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofread_suggestions" ADD CONSTRAINT "proofread_suggestions_user_id_chapter_id_chapters_user_id_id_fk" FOREIGN KEY ("user_id","chapter_id") REFERENCES "public"."chapters"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofread_suggestions" ADD CONSTRAINT "proofread_suggestions_user_id_page_id_pages_user_id_id_fk" FOREIGN KEY ("user_id","page_id") REFERENCES "public"."pages"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_skip_images" ADD CONSTRAINT "series_skip_images_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_skip_images" ADD CONSTRAINT "series_skip_images_user_id_series_id_series_user_id_id_fk" FOREIGN KEY ("user_id","series_id") REFERENCES "public"."series"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_user_id_chapter_id_chapters_user_id_id_fk" FOREIGN KEY ("user_id","chapter_id") REFERENCES "public"."chapters"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "glossary_user_series_idx" ON "glossary_entries" USING btree ("user_id","series_id");--> statement-breakpoint
CREATE INDEX "jobs_user_idx" ON "jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "series_user_idx" ON "series" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_ledger_user_created_idx" ON "usage_ledger" USING btree ("user_id","created_at");