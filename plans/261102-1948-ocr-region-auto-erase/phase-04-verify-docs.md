# Phase 4 — Kiểm thử + docs

## Chạy
- `cd worker && uv run pytest` (handlers, textmask)
- `pnpm --filter @mtl/api test`, `pnpm --filter @mtl/shared test` (contract schema), `pnpm --filter @mtl/web test`
- `pnpm --filter @mtl/web e2e editor chapter-tools` (fake worker nhánh bbox)
- Thử tay: worker thật `--provider anthropic`, chương arm-boy-rivalry trang 2 (SFX 확) — trước/sau.

## Docs
- `docs/job-queue-worker.md`: payload `page.reinpaint.auto_text_bbox`, version 0.9.0.
- `docs/deployment-guide.md`: mục nâng cấp 0.9.0 (worker trước API, như các lần trước).
- Ghi chú trong `docs/` về luồng editor nếu có mục OCR vùng.
