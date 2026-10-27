-- Bỏ workspace (chỉ drop; 0017 thêm user_id). Thứ tự: FK → unique → index → cột → bảng, để không phụ thuộc lẫn nhau.
ALTER TABLE "chapters" DROP CONSTRAINT "chapters_workspace_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "chapters" DROP CONSTRAINT "chapters_workspace_id_series_id_series_workspace_id_id_fk";--> statement-breakpoint
ALTER TABLE "glossary_entries" DROP CONSTRAINT "glossary_entries_workspace_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "glossary_entries" DROP CONSTRAINT "glossary_entries_workspace_id_series_id_series_workspace_id_id_fk";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_workspace_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_workspace_id_chapter_id_chapters_workspace_id_id_fk";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_workspace_id_page_id_pages_workspace_id_id_fk";--> statement-breakpoint
ALTER TABLE "page_state_history" DROP CONSTRAINT "page_state_history_workspace_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "page_state_history" DROP CONSTRAINT "page_state_history_workspace_id_page_id_pages_workspace_id_id_fk";--> statement-breakpoint
ALTER TABLE "page_states" DROP CONSTRAINT "page_states_workspace_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "page_states" DROP CONSTRAINT "page_states_workspace_id_page_id_pages_workspace_id_id_fk";--> statement-breakpoint
ALTER TABLE "pages" DROP CONSTRAINT "pages_workspace_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "pages" DROP CONSTRAINT "pages_workspace_id_chapter_id_chapters_workspace_id_id_fk";--> statement-breakpoint
ALTER TABLE "proofread_suggestions" DROP CONSTRAINT "proofread_suggestions_workspace_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "proofread_suggestions" DROP CONSTRAINT "proofread_suggestions_workspace_id_chapter_id_chapters_workspace_id_id_fk";--> statement-breakpoint
ALTER TABLE "proofread_suggestions" DROP CONSTRAINT "proofread_suggestions_workspace_id_page_id_pages_workspace_id_id_fk";--> statement-breakpoint
ALTER TABLE "series" DROP CONSTRAINT "series_workspace_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "series_skip_images" DROP CONSTRAINT "series_skip_images_workspace_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "series_skip_images" DROP CONSTRAINT "series_skip_images_workspace_id_series_id_series_workspace_id_id_fk";--> statement-breakpoint
ALTER TABLE "source_files" DROP CONSTRAINT "source_files_workspace_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "source_files" DROP CONSTRAINT "source_files_workspace_id_chapter_id_chapters_workspace_id_id_fk";--> statement-breakpoint
ALTER TABLE "usage_ledger" DROP CONSTRAINT "usage_ledger_workspace_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "worker_tokens" DROP CONSTRAINT "worker_tokens_workspace_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "chapters" DROP CONSTRAINT "chapters_ws_id_uq";--> statement-breakpoint
ALTER TABLE "glossary_entries" DROP CONSTRAINT "glossary_entries_scope_term_uq";--> statement-breakpoint
ALTER TABLE "pages" DROP CONSTRAINT "pages_ws_id_uq";--> statement-breakpoint
ALTER TABLE "series" DROP CONSTRAINT "series_ws_id_uq";--> statement-breakpoint
DROP INDEX "glossary_ws_series_idx";--> statement-breakpoint
DROP INDEX "jobs_ws_idx";--> statement-breakpoint
DROP INDEX "series_ws_idx";--> statement-breakpoint
DROP INDEX "usage_ledger_ws_created_idx";--> statement-breakpoint
DROP INDEX "worker_tokens_ws_idx";--> statement-breakpoint
ALTER TABLE "chapters" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "glossary_entries" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "page_state_history" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "page_states" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "pages" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "proofread_suggestions" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "series" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "series_skip_images" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "source_files" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "usage_ledger" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "worker_tokens" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "session" DROP COLUMN "active_organization_id";--> statement-breakpoint
DROP TABLE "workspace_fonts" CASCADE;--> statement-breakpoint
DROP TABLE "workspace_settings" CASCADE;--> statement-breakpoint
DROP TABLE "invitation" CASCADE;--> statement-breakpoint
DROP TABLE "member" CASCADE;--> statement-breakpoint
DROP TABLE "organization" CASCADE;--> statement-breakpoint
ALTER TABLE "glossary_entries" ADD CONSTRAINT "glossary_entries_scope_term_uq" UNIQUE NULLS NOT DISTINCT("series_id","source_lang","target_lang","source_term");
