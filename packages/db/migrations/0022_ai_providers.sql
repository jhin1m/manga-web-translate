CREATE TABLE "ai_models" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"price_in" numeric NOT NULL,
	"price_out" numeric NOT NULL,
	"vision" boolean DEFAULT false NOT NULL,
	"reasoning" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_models_provider_model_uq" UNIQUE("provider_id","model_id"),
	CONSTRAINT "ai_models_price_chk" CHECK ("ai_models"."price_in" >= 0 and "ai_models"."price_out" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text,
	"api_key_enc" text NOT NULL,
	"key_last4" text NOT NULL,
	"structured_output" text DEFAULT 'json_schema' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_providers_type_chk" CHECK ("ai_providers"."type" in ('anthropic', 'gemini', 'openai', 'openai_compatible')),
	CONSTRAINT "ai_providers_base_url_chk" CHECK (("ai_providers"."type" = 'openai_compatible') = ("ai_providers"."base_url" is not null)),
	CONSTRAINT "ai_providers_structured_output_chk" CHECK ("ai_providers"."structured_output" in ('json_schema', 'json_object'))
);
--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "ocr_model_id" uuid;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "translate_model_id" uuid;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "proofread_model_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_ocr_model_id_ai_models_id_fk" FOREIGN KEY ("ocr_model_id") REFERENCES "public"."ai_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_translate_model_id_ai_models_id_fk" FOREIGN KEY ("translate_model_id") REFERENCES "public"."ai_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_proofread_model_id_ai_models_id_fk" FOREIGN KEY ("proofread_model_id") REFERENCES "public"."ai_models"("id") ON DELETE restrict ON UPDATE no action;