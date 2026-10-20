CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"number" numeric NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"ingest_rev" integer DEFAULT 0 NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapters_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "chapters_status_chk" CHECK ("chapters"."status" in ('draft', 'ingesting', 'processing', 'review', 'partial_failed', 'done'))
);
--> statement-breakpoint
CREATE TABLE "glossary_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"series_id" uuid,
	"source_term" text NOT NULL,
	"target_term" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"case_sensitive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"input_rev" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"provider_retries" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" uuid,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"progress" real DEFAULT 0 NOT NULL,
	"stage" text,
	"error_class" text,
	"error" text,
	"pipeline_version" text,
	"chapter_id" uuid,
	"page_id" uuid,
	"dispatch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_type_chk" CHECK ("jobs"."type" in ('chapter.ingest', 'page.prepare', 'chapter.translate', 'page.reinpaint', 'page.ocr_region', 'chapter.export')),
	CONSTRAINT "jobs_status_chk" CHECK ("jobs"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'paused_budget')),
	CONSTRAINT "jobs_error_class_chk" CHECK ("jobs"."error_class" is null or "jobs"."error_class" in ('provider', 'rate_limited', 'schema', 'invalid_input', 'internal'))
);
--> statement-breakpoint
CREATE TABLE "page_state_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"state" jsonb,
	"actor" text NOT NULL,
	"batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_states" (
	"page_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"state" jsonb,
	"ai_state" jsonb,
	"ai_rev" integer DEFAULT 0 NOT NULL,
	"state_origin" text DEFAULT 'ai' NOT NULL,
	"ai_update_available" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_states_origin_chk" CHECK ("page_states"."state_origin" in ('ai', 'user'))
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"ord" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"original_key" text NOT NULL,
	"original_sha256" text NOT NULL,
	"clean_rev" integer,
	"mask_rev" integer,
	"next_rev" integer DEFAULT 1 NOT NULL,
	"ocr_result" jsonb,
	"prepare_input_rev" text,
	"source_map" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cut_flag" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "pages_status_chk" CHECK ("pages"."status" in ('pending', 'preparing', 'prepared', 'translating', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source_lang" text DEFAULT 'ko' NOT NULL,
	"target_lang" text DEFAULT 'vi' NOT NULL,
	"honorific_policy" text DEFAULT 'translate' NOT NULL,
	"pronoun_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"style_prompt" text DEFAULT '' NOT NULL,
	"default_fonts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"llm_tier" text DEFAULT 'default' NOT NULL,
	"glossary_rev" integer DEFAULT 0 NOT NULL,
	"settings_rev" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "source_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"ord" integer NOT NULL,
	"storage_key" text NOT NULL,
	"bytes" bigint NOT NULL,
	"mime" text NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"job_id" uuid,
	"attempt" integer DEFAULT 0 NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"quantity" numeric NOT NULL,
	"unit_cost_usd" numeric NOT NULL,
	"cost_usd" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_ledger_job_attempt_seq_kind_uq" UNIQUE("job_id","attempt","seq","kind"),
	CONSTRAINT "usage_ledger_kind_chk" CHECK ("usage_ledger"."kind" in ('pages', 'llm_tokens_in', 'llm_tokens_out', 'gpu_seconds', 'gpu_idle_seconds', 'storage_bytes'))
);
--> statement-breakpoint
CREATE TABLE "worker_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"workspace_id" uuid,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "workspace_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"worker_mode" text DEFAULT 'mac' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_settings_worker_mode_chk" CHECK ("workspace_settings"."worker_mode" in ('mac', 'modal'))
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_workspace_id_series_id_series_workspace_id_id_fk" FOREIGN KEY ("workspace_id","series_id") REFERENCES "public"."series"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary_entries" ADD CONSTRAINT "glossary_entries_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary_entries" ADD CONSTRAINT "glossary_entries_workspace_id_series_id_series_workspace_id_id_fk" FOREIGN KEY ("workspace_id","series_id") REFERENCES "public"."series"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_lease_owner_worker_tokens_id_fk" FOREIGN KEY ("lease_owner") REFERENCES "public"."worker_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_chapter_id_chapters_workspace_id_id_fk" FOREIGN KEY ("workspace_id","chapter_id") REFERENCES "public"."chapters"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_page_id_pages_workspace_id_id_fk" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_state_history" ADD CONSTRAINT "page_state_history_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_state_history" ADD CONSTRAINT "page_state_history_workspace_id_page_id_pages_workspace_id_id_fk" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_states" ADD CONSTRAINT "page_states_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_states" ADD CONSTRAINT "page_states_workspace_id_page_id_pages_workspace_id_id_fk" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."pages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_workspace_id_chapter_id_chapters_workspace_id_id_fk" FOREIGN KEY ("workspace_id","chapter_id") REFERENCES "public"."chapters"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_workspace_id_chapter_id_chapters_workspace_id_id_fk" FOREIGN KEY ("workspace_id","chapter_id") REFERENCES "public"."chapters"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_tokens" ADD CONSTRAINT "worker_tokens_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapters_series_idx" ON "chapters" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "glossary_ws_series_idx" ON "glossary_entries" USING btree ("workspace_id","series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_active_uq" ON "jobs" USING btree ("idempotency_key") WHERE "jobs"."status" in ('queued', 'running', 'paused_budget');--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("priority","created_at") WHERE "jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "jobs_ws_idx" ON "jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_chapter_idx" ON "jobs" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "jobs_page_idx" ON "jobs" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "jobs_lease_owner_idx" ON "jobs" USING btree ("lease_owner");--> statement-breakpoint
CREATE INDEX "page_state_history_page_idx" ON "page_state_history" USING btree ("page_id","version");--> statement-breakpoint
CREATE INDEX "page_state_history_batch_idx" ON "page_state_history" USING btree ("batch_id") WHERE "page_state_history"."batch_id" is not null;--> statement-breakpoint
CREATE INDEX "pages_chapter_idx" ON "pages" USING btree ("chapter_id","ord");--> statement-breakpoint
CREATE INDEX "series_ws_idx" ON "series" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "source_files_chapter_idx" ON "source_files" USING btree ("chapter_id","ord");--> statement-breakpoint
CREATE INDEX "usage_ledger_ws_created_idx" ON "usage_ledger" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "worker_tokens_ws_idx" ON "worker_tokens" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");