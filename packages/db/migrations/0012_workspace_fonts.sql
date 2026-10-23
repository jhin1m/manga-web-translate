CREATE TABLE "workspace_fonts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
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
	CONSTRAINT "workspace_fonts_font_id_unique" UNIQUE("font_id"),
	CONSTRAINT "workspace_fonts_ws_sha_uq" UNIQUE("workspace_id","sha256")
);
--> statement-breakpoint
ALTER TABLE "workspace_fonts" ADD CONSTRAINT "workspace_fonts_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;