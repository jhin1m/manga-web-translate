CREATE TABLE "series_skip_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"dhash" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"thumb_key" text NOT NULL,
	"learned_from_chapter_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_files" ADD COLUMN "dhash" text;--> statement-breakpoint
ALTER TABLE "series_skip_images" ADD CONSTRAINT "series_skip_images_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_skip_images" ADD CONSTRAINT "series_skip_images_workspace_id_series_id_series_workspace_id_id_fk" FOREIGN KEY ("workspace_id","series_id") REFERENCES "public"."series"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "series_skip_images_series_idx" ON "series_skip_images" USING btree ("series_id");