-- Bỏ workspace: dữ liệu cũ (organization/member/workspace_id) không chuyển được sang mô hình 1 người 1 tài khoản →
-- DB có workspace phải reset trước (docs/development-setup.md). Guard đứng đầu để không đổi gì khi bị chặn.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "organization") THEN
    RAISE EXCEPTION 'DB còn dữ liệu workspace — reset DB trước (docs/development-setup.md, mục Reset DB dev)';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "worker_tokens" ADD COLUMN "kind" text;--> statement-breakpoint
-- Token cũ: có workspace = Mac của nhóm, null = worker nền tảng (Modal).
UPDATE "worker_tokens" SET "kind" = CASE WHEN "workspace_id" IS NULL THEN 'modal' ELSE 'mac' END;--> statement-breakpoint
ALTER TABLE "worker_tokens" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "worker_tokens" ADD CONSTRAINT "worker_tokens_kind_chk" CHECK ("worker_tokens"."kind" in ('mac', 'modal'));
