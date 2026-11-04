CREATE TABLE "system_fonts" (
	"id" uuid PRIMARY KEY NOT NULL,
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
	CONSTRAINT "system_fonts_font_id_unique" UNIQUE("font_id"),
	CONSTRAINT "system_fonts_sha256_unique" UNIQUE("sha256")
);
