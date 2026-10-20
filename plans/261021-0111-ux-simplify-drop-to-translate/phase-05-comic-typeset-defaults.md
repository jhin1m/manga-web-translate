# Phase 5 — Typeset mặc định chất manga

Status: Done (2026-10-21, chờ controller review/merge; report: [phase-05-261021-ux-simplify-report.md](../reports/phase-05-261021-ux-simplify-report.md)) · Branch: `feat/ux-p5-typeset` · Context: [plan.md](./plan.md), [docs/typeset-layout-contract.md](../../docs/typeset-layout-contract.md)

## Vấn đề
Bản dịch dùng PatrickHand, `stroke: null`, trông như chữ gõ dán lên. Torii: font comic (WildWords) in hoa đậm, viền trắng. Memory dự án: MVP chưa ràng buộc license, nhưng ưu tiên font OFL để khỏi phải thay sau.

## Yêu cầu
- Chọn 1 font comic/manga-lettering **OFL** từ repo chính thức `github.com/google/fonts` (raw file, nguồn tin cậy) có **đủ glyph tiếng Việt** (manifest `viComplete: true`, `missing: []`). Ứng viên kiểm theo thứ tự: Bangers, Comic Neue (Bold), Itim/Mali (đã có), Baloo 2 Bold (đã có, variable). Chọn font trông giống lettering manga nhất trong số đạt `viComplete`; ghi lý do ngắn trong docs. Không tải font từ nguồn khác.
- Thêm font vào `worker/fonts/` + `apps/web/public/fonts/` + 2 `manifest.json` (dùng script sinh manifest hiện có — tìm trong `scripts/` hoặc `worker/`; không viết tay số đo). Cập nhật danh sách font series (`apps/api/src/routes/series.ts:29`, `apps/web/src/features/series/api.ts:5`).
- Mặc định thoại: font mới + viền trắng (`stroke` theo `TextStroke` trong `packages/shared/src/page-state.ts`; độ dày tỉ lệ cỡ chữ, ví dụ ~0.08–0.12 × font_size, chọn bằng mắt trên chương mẫu) — đổi ở 1 nguồn mặc định: `worker/mtl_pipeline/pipeline.py:31` `DEFAULT_FONT`, `apps/api/src/jobs/enqueue.ts:35` `DEFAULT_DIALOGUE_FONT`, `manifest.defaults[0]`, nơi worker dựng `TextBox` (stroke). Series đã chọn font riêng giữ nguyên.
- Parity Konva ↔ render.py phải giữ (`pnpm --filter @mtl/web e2e typeset-parity`); test Python worker liên quan (`worker/` — chạy pytest theo `docs/job-queue-worker.md`).
- Worker local đang chạy (PID của `mtl-worker`) nạp code cũ: sau khi merge controller sẽ restart; phase này không cần restart nhưng ghi chú.

## File
- `worker/fonts/*`, `apps/web/public/fonts/*`, `worker/mtl_pipeline/pipeline.py` (+ nơi tạo text box), `apps/api/src/jobs/enqueue.ts`, `apps/api/src/routes/series.ts`, `apps/web/src/features/series/api.ts`, `docs/typeset-layout-contract.md` hoặc `docs/design-guidelines.md` (1 đoạn font mặc định).
- Test: pytest worker typeset/render, e2e `typeset-parity`, vitest `measure.test.ts`.

## Kiểm chứng
- Render chương mẫu bằng CLI worker (`worker/mtl_pipeline/cli.py`, xem `--font`) ra PNG trong scratchpad, xem bằng mắt (Read ảnh) so với ảnh Torii mô tả ở plan: chữ đậm, có viền trắng, không vỡ dấu tiếng Việt (ộ, ữ, ẫ…).
- `pnpm typecheck && pnpm lint && pnpm test` + e2e `typeset-parity` + pytest worker.
