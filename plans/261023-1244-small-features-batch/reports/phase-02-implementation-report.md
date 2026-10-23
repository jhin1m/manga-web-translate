# Báo cáo triển khai Phase 2 — Chữ theo màu gốc

## Tệp thay đổi
- Mới: `worker/mtl_pipeline/textcolor.py`, `worker/tests/test_textcolor.py`
- Worker: `textmask.py` (đo màu thô theo mask chưa giãn), `schema.py` (`text_color`, `outline_color`, private `_glyph_rgb`), `pipeline.py` (`assign_colors` sau inpaint), `typeset.py` (`style_for(region, size, bg_rgb)`, `typeset_region` truyền median nền), `mtl_worker/runner.py` (shared conversion), `mtl_worker/__init__.py` (PIPELINE_VERSION 0.5.0; MIN không đổi)
- Shared: `packages/shared/src/page-state.ts` (Region; OcrRegion kế thừa nên `job.ts` không cần sửa), `test/shared-contracts.test.ts`, JSON schema đã emit lại (`pnpm schema:emit`)
- Web: `apps/web/src/features/editor/actions.ts` (`contrastStroke` theo luma, khớp worker) + test
- Docs: `docs/typeset-layout-contract.md`, `docs/job-queue-worker.md`, `TODO.md` (tick), phase file (completed)
- API: không đổi. `queue.ts` lưu `result.ocr_result` nguyên khối; `claim-inputs.ts` chuyển `pg.ocrResult` / `partial.regions` nguyên khối. Handler prepare dùng chung `region_to_shared`, nên không cần sửa handlers.py.

## Ngưỡng
- Viền thật: ΔE CIE76 > 20 so với nền sạch và so với màu chữ (ring 3px ngoài mask chưa giãn, median).
- Snap đen/trắng: ΔE < 12.
- Giữ màu gốc: tương phản WCAG ≥ 3:1 (chữ hoặc viền) so với median ảnh clean trong vùng đặt chữ; viền gốc dùng khi tương phản với chữ ≥ 3, ngược lại viền đen/trắng theo luma Rec.601 > 128 (worker `contrast_stroke` ≡ editor `contrastStroke`).

## Kiểm thử
- `cd worker && uv run pytest`: 175 passed (kể cả test typeset/polarity cũ không đổi); ruff check/format sạch.
- `pnpm --filter @mtl/shared test`: 18 passed; `pnpm --filter @mtl/web test`: 181 passed.
- `pnpm typecheck`: shared/db/web pass; apps/api fail chỉ ở `test/chapters.test.ts` (Phase 1, ngoài phạm vi). `pnpm lint`: lỗi chỉ ở `apps/api/src/routes/pages.ts` (Phase 1).

## Lưu ý
- `contrastStroke` trước đây chỉ trắng→đen, còn lại→trắng; giờ theo luma 128 (đỏ #ff0000 → viền trắng, vàng sáng → viền đen). Hành vi với đen/trắng không đổi.
- Chưa soi mắt trang thật: repo không có trang mẫu (model ONNX có sẵn nhưng không có ảnh). Tiêu chí để trống.
- Màu SFX cũng được đo (SFX chỉ biết sau OCR) nhưng không dùng vì SFX không đặt chữ.
- `PIPELINE_VERSION` worker 0.5.0; hằng muối input_rev của API không đổi theo yêu cầu.
