-- Dữ liệu cũ có thể đã trùng term (tạo đồng thời trước khi có ràng buộc): giữ bản sửa gần nhất mỗi phạm vi.
DELETE FROM "glossary_entries" g
USING "glossary_entries" newer
WHERE g."workspace_id" = newer."workspace_id"
  AND g."series_id" IS NOT DISTINCT FROM newer."series_id"
  AND g."source_term" = newer."source_term"
  AND (g."updated_at", g."id") < (newer."updated_at", newer."id");--> statement-breakpoint
ALTER TABLE "glossary_entries" ADD CONSTRAINT "glossary_entries_scope_term_uq" UNIQUE NULLS NOT DISTINCT("workspace_id","series_id","source_term");
