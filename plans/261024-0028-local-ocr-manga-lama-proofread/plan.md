---
title: "Cài đặt pipeline + OCR local + LaMa manga + AI hiệu đính"
status: completed
branch: feat/pipeline-settings-local-ocr-proofread
brief: goal-brief.md
---

# Plan: pipeline settings, OCR local, LaMa manga, AI hiệu đính

Chạy không người trực theo [goal-brief.md](./goal-brief.md). Quyết định tự chốt ghi ở từng phase + báo cáo cuối.

## Phases

| # | Phase | Status | Phụ thuộc |
|---|---|---|---|
| 1 | [Hợp đồng cài đặt pipeline + DB + API + UI](./phase-01-pipeline-settings.md) | completed | — |
| 2 | [LaMa manga + detector CTD + tham số inpaint/mask](./phase-02-lama-manga-detector.md) | completed | 1 |
| 3 | [OCR local: manga-ocr + PaddleOCR (ONNX)](./phase-03-local-ocr.md) | completed | 1 |
| 4 | [AI hiệu đính (chapter.proofread)](./phase-04-ai-proofread.md) | completed | 1 |
| 5 | [Docs, README, deploy checklist, review, báo cáo](./phase-05-docs-review-report.md) | completed | 2,3,4 |

## Hợp đồng chốt (dùng chung mọi phase)

- `packages/shared/src/pipeline-settings.ts`: `PipelineSettings` (detector, detection_threshold, ocr_engines theo
  nguồn ko/ja/zh/en, inpainter, mask_dilation `null`=tự động, inpaint_size, proofread_tier) + `DEFAULT_PIPELINE_SETTINGS`
  = hành vi hiện tại; `prepareOptions(settings, lang)` → `PrepareOptions` snapshot vào payload `page.prepare.pipeline`;
  `page.reinpaint.inpaint`, `page.ocr_region.ocr_engine` (optional — job cũ thiếu → worker mặc định cũ).
- DB: `workspace_settings.pipeline jsonb default '{}'` (migration 0013 + down). API đọc = defaults ⊕ stored (key lỗi bỏ).
- input_rev `page.prepare`: chỉ trộn hash tuỳ chọn khi khác mặc định → workspace cũ giữ nguyên input_rev.
- Job mới `chapter.proofread` (LLM, tính tiền); OCR local `page.prepare` không qua breaker/kill-switch (usage 0).
- Worker `PIPELINE_VERSION` 0.6.0, API `MIN_PIPELINE_VERSION` 0.6.0 (schema payload strict).
- Model mới trong `models.lock.json` có `optional: true`: không bắt buộc lúc khởi động, tải lazy (sha256) khi job cần.

## Acceptance

- 4 mục phạm vi chạy end-to-end; `pnpm typecheck && pnpm lint && pnpm test`, `uv run pytest`, e2e web xanh.
- Smoke test model thật (OCR local + LaMa manga) có số đo hoặc lý do.
- `/ak:code-review` xong, finding thật đã sửa; báo cáo `plans/reports/overnight-261024-0028-…-report.md`.
