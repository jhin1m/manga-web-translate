---
phase: 1
title: "Hợp đồng cài đặt pipeline + DB + API + UI"
status: pending
priority: P1
effort: "3h"
dependencies: []
---

# Phase 1: Hợp đồng cài đặt pipeline + DB + API + UI

## Overview
Cài đặt pipeline cấp workspace (owner/admin sửa), snapshot vào payload job lúc enqueue, mặc định = hành vi hiện tại.

## Requirements
- Option: detector (`rtdetr_v2_comic` | `comic_text_detector`), detection_threshold (0.35), OCR engine theo nguồn
  (`llm` | `manga_ocr` chỉ ja | `paddle_ocr` ko/zh/ja/en), inpainter (`big_lama` | `lama_manga`), mask_dilation
  (`null` = tự động 2–6px theo box), inpaint_size (512), proofread_tier (`standard` | `premium`).
- Worker không đọc DB: payload `page.prepare.pipeline`, `page.reinpaint.inpaint`, `page.ocr_region.ocr_engine`.
- Worker cũ bị chặn: `MIN_PIPELINE_VERSION = 0.6.0`.

## Architecture
- `packages/shared/src/pipeline-settings.ts` (zod + defaults + `prepareOptions` + `ocrEngineAllowed`), JobPayload thêm
  field optional; `pnpm schema:emit`.
- DB `workspace_settings.pipeline jsonb not null default '{}'`, migration 0013 + down.
- API: `GET /w/:ws` trả `settings.pipeline`; `PUT /w/:ws/settings/pipeline` (admin) validate + lưu. Enqueue prepare /
  reinpaint / ocr-region đọc cài đặt workspace (`pipelineSettingsOf(tx, ws)`).
- `prepareKey` trộn hash `PrepareOptions` khi khác mặc định (job/page cũ giữ input_rev).
- Breaker/kill-switch: `page.prepare` với OCR local không coi là job LLM/tính tiền (helper `isLlmPayload` + SQL).
- Web: `workspace-settings.tsx` thêm tab "Pipeline" (`features/pipeline/pipeline-settings.tsx`): nhãn VI + thuật ngữ
  EN + tooltip (`title` + icon ?), mục "Nâng cao" `<details>` (threshold, dilation, size). Member chỉ xem.

## Related Code Files
- Create: `packages/shared/src/pipeline-settings.ts`, `packages/db/migrations/0013_*.sql`,
  `packages/db/migrations-down/0013_*.down.sql`, `apps/web/src/features/pipeline/*`, test API/shared/web.
- Modify: `packages/shared/src/job.ts`, `index.ts`, `packages/db/src/schema/app.ts`, `apps/api/src/routes/workspaces.ts`,
  `apps/api/src/jobs/{enqueue,idempotency,queue}.ts`, `apps/api/src/billing/budget.ts`, `apps/api/src/env.ts`,
  `apps/api/src/routes/pages.ts`, `apps/web/src/routes/workspace-settings.tsx`, `worker/mtl_worker/__init__.py`.

## Implementation Steps
1. Shared contract + test; schema:emit.
2. Migration + schema drizzle.
3. API route + enqueue snapshot + input_rev + breaker/budget exemption + tests (workspace settings, enqueue payload).
4. Web tab + e2e nhỏ (owner đổi OCR engine, lưu, tải lại thấy giá trị).
5. Worker: bump version, chấp nhận payload mới (handler đọc options nhưng chưa dùng engine mới → phase 2/3).

## Success Criteria
- [ ] Workspace không cấu hình → payload chỉ thêm `pipeline` = mặc định, input_rev không đổi.
- [ ] Member PUT → 403; giá trị sai (manga_ocr cho ko) → 400.
- [ ] Typecheck/lint/test xanh.

## Risk Assessment
Schema strict → worker cũ 426 ngay khi API lên: ghi checklist deploy (worker trước API).
