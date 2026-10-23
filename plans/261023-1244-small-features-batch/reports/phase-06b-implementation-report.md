# Báo cáo triển khai Phase 6b — font tuỳ chỉnh trong job (API → worker)

Phạm vi: bước 5 và 7 của `phase-06-font-tuy-chinh-workspace.md`. Không commit.

## Thay đổi
- **Job inputs**: `JobFonts = [{id, url, sha256}]` (optional) thêm vào `TranslateInputs` và `ExportInputs` (`packages/shared/src/worker-protocol.ts`), đã chạy `pnpm schema:emit`. Optional để API cũ (rollback) vẫn hợp lệ với worker mới.
- **API** (`apps/api/src/jobs/claim-inputs.ts`): `fontInputs` dùng `resolveCustomFonts(scoped(tx, ws))` + `presignGet`.
  - translate: `settings.font` + `settings.narration_font` của payload (snapshot lúc enqueue, đúng thứ worker sẽ dùng), TTL 10'.
  - export: `font_family` của box ở trang được vẽ chữ + font mặc định series, TTL 15' (như URL nền).
  - Chỉ font có thật trong workspace của job; id gói sẵn / workspace khác / đã xoá bị bỏ.
- **Worker**:
  - `mtl_pipeline/fonts.py`: registry `use_fonts(...)` (context manager, khôi phục trạng thái cũ); `font_path` tra registry → `FONTS_DIR` → fallback `DEFAULT_FONT` + log 1 lần/id (không ném lỗi); `metrics_for` cache theo đường dẫn file.
  - `mtl_pipeline/render.py`: cache `load_font` theo file chứ không theo id (id → file đổi giữa các job nên cache theo id sẽ giữ nhầm font fallback).
  - `mtl_worker/job_fonts.py` (mới): tải vào `~/.cache/mtl-worker/fonts/<sha256>` (`MTL_FONT_CACHE_DIR`), kiểm sha256, đọc thử bằng fontTools, ghi nguyên tử. Sai hash / font hỏng → bỏ qua (fallback, log); lỗi mạng → ném lên để job thử lại. Chỉ tải URL trong inputs.
  - `runner.py`: bọc handler bằng `job_fonts(inputs.get("fonts"), ctx.download)`. Không cần sửa `handlers.py`/`export.py`.
- **Phiên bản**: `PIPELINE_VERSION` worker 0.5.0 → **0.5.1**; `MIN_PIPELINE_VERSION` mặc định `env.ts` 0.4.2 → **0.5.1**. Lý do: 0.5.0 chưa từng ra HEAD (HEAD là 0.4.2) nhưng bản 0.5.0 trung gian có thể đang chạy ở máy dev, không có `fonts`, và schema input `additionalProperties: false` không cho worker cũ đọc job có font; MIN phải loại chúng. API `PIPELINE_VERSION` (muối input_rev) không đổi → không chạy lại job đã xong. Cập nhật `VERSION` ở `apps/api/test/worker-helpers.ts` và `apps/web/e2e/fake-worker.ts` lên 0.5.1.
- **Docs**: `docs/job-queue-worker.md` (mục Font tuỳ chỉnh + ghi chú version), `docs/typeset-layout-contract.md` (metrics font tuỳ chỉnh cùng quy tắc manifest), `docs/deployment-guide.md` (thứ tự deploy: worker trước, API sau), `README.md` (bỏ mục font tuỳ chỉnh khỏi "còn thiếu", cập nhật mục Deploy), `TODO.md` (tick). Phase file: status completed.

## Kiểm thử
- Mới: `apps/api/test/claim-fonts.test.ts` (4: translate font/narration, bỏ gói sẵn/workspace khác/đã xoá, export box + mặc định, rỗng); `worker/tests/test_job_fonts.py` (8: registry + khôi phục, fallback + log, render bằng font đăng ký không đuôi = bản gói sẵn và ≠ fallback, cache theo sha, sai hash/font hỏng bị từ chối, lỗi mạng ném lên, contract schema).
- Xanh: `uv run pytest` 184, `ruff check` + `ruff format --check`; `@mtl/shared` 28; `@mtl/api` 228 (chạy riêng); `@mtl/web` 190; `pnpm typecheck`; `pnpm lint`; e2e Playwright 32/32.
- Không có route mới nên tenant-isolation không đổi.

## Chưa làm / lưu ý
- Soi mắt parity Konva ↔ render.py trên 1 trang font tuỳ chỉnh: thủ công, để chưa tick.
- Font sai hash bị bỏ qua và fallback (không fail job) — chọn để job không kẹt vì 1 font hỏng; đổi lại nếu muốn fail cứng.
- Translate: box lưu `font_family` = id font (kể cả khi worker fallback) nên editor/export sau này vẫn dùng font tuỳ chỉnh nếu nó còn tồn tại.
