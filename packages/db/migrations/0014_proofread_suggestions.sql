CREATE TABLE "proofread_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"job_id" uuid,
	"region_id" text NOT NULL,
	"old_text" text NOT NULL,
	"suggestion" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proofread_suggestions_page_region_uq" UNIQUE("page_id","region_id")
);
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_type_chk";--> statement-breakpoint
ALTER TABLE "proofread_suggestions" ADD CONSTRAINT "proofread_suggestions_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofread_suggestions" ADD CONSTRAINT "proofread_suggestions_workspace_id_chapter_id_chapters_workspace_id_id_fk" FOREIGN KEY ("workspace_id","chapter_id") REFERENCES "public"."chapters"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofread_suggestions" ADD CONSTRAINT "proofread_suggestions_workspace_id_page_id_pages_workspace_id_id_fk" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proofread_suggestions_chapter_idx" ON "proofread_suggestions" USING btree ("chapter_id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_chk" CHECK ("jobs"."type" in ('chapter.ingest', 'page.prepare', 'chapter.translate', 'page.reinpaint', 'page.ocr_region', 'chapter.export', 'chapter.proofread'));