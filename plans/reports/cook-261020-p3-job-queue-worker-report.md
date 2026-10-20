# Cook report — Phase 3: job queue + worker protocol + worker local Mac

Ngày 20/10/2026 · branch `feat/p3-job-queue-worker` (chưa merge) · plan: `261019-1847-manga-translate-editor-mvp/phase-03-job-queue-worker.md` (status → completed; plan.md không sửa).

## Đã làm
- **Hợp đồng chung** (`packages/shared`): `worker-protocol.ts` (claim/heartbeat/presign/complete/fail/usage, inputs theo loại job); `JobPayload` ingest có `mode`, translate có snapshot `settings` (glossary gộp, xưng hô, style, font); `PreparePartial`. **PageState khớp `docs/typeset-layout-contract.md`**: TextBox `font`→`font_family`, `size`→`font_size`, thêm `pad`; `OcrRegion.bubble_id`, `OcrItem.low_conf`. JSON Schema emit lại.
- **DB** migration `0001_job_queue_worker` (additive + down tay): `runtime_flags`; `jobs.claimed_at/worker_id/output_rev`; `pages.prepare_partial`; index reaper.
- **API**: `jobs/queue.ts` (claim SKIP LOCKED lọc workspace/worker_mode/breaker/pipeline_version 426; fencing `lease_owner`+`lease_token`+`attempt` → 409 không ghi; complete lặp no-op; output rev bất biến + HEAD kiểm object), `enqueue.ts` (idempotent theo partial unique, ingest/prepare/translate/retry-failed/retranslate/reinpaint/ocr_region, tiến 2 giai đoạn có khoá dòng chapter), `errors.ts` (provider/rate_limited không tính attempt, Retry-After, ≤20; schema/internal 3 lần; invalid_input ngay), `breaker.ts`, `reaper.ts` + `runner.ts` (process riêng, `pnpm jobs`), `page-state-writer.ts` (luật AI-không-ghi-đè, history 50), `billing/{prices,ledger}.ts` (clamp + giá server, model lạ → giá cao nhất), `lib/chapter-lock.ts` (423), `lib/worker-token.ts` (sha256 + constant-time). Routes: `/worker/v1/*`, `GET /api/w/:ws/chapters/:id/progress`, `GET|POST /api/w/:ws/jobs/:id(/cancel)`; thêm case tenant-isolation.
- **Worker Python** `worker/mtl_worker`: `main` (CLI `mtl-worker`, HF_HUB_OFFLINE=1, model nạp + kiểm lock 1 lần, SIGTERM grace), `client` (409→bỏ job, claim không retry), `runner` (heartbeat thread 20s, usage delta có seq, map lỗi), `handlers` (prepare: LLM cuối + partial khi lỗi provider; translate: ngữ cảnh lân cận, typeset → PageState chung; reinpaint; ocr_region), `ingest` + `mtl_pipeline/ingest.py` (strip ảo, cắt ở hàng không giao box, kéo tới 12000px, cut_flag), `token` (file 600/Keychain). `chapter.export` hoãn tường minh (Phase 6). launchd plist mẫu. `scripts/worker-token.ts` (ghi file 600).
- Docs: `docs/job-queue-worker.md`, cập nhật `docs/development-setup.md`.

## Kiểm chứng
- `pnpm typecheck` / `lint` / `test` xanh: shared 8, db 3, api **57** (thêm queue, worker-protocol, worker-fencing, error-classes, ai-write-rules, cancel-and-recovery). Worker: ruff, mypy, pytest **99** xanh. Tester chạy `pnpm test` 2 lần, không flaky.
- Smoke thật (DB riêng, đã xoá): API + worker Python, pipeline ONNX thật, MinIO thật, **LLM giả** (chưa có key): 12 slice 720×1500 → 4 page (~4500px, 1 page né box còn 4478) → 20/20 bóng detect + typeset → chapter `review`, ledger đúng giá. Runner ghi `runner_heartbeat`.
- Code review (7/10): đã sửa H1 (3 nhánh huỷ làm kẹt chương), H2 (job input hỏng chặn claim → fail job tại claim; kiểm `user_mask_key`), H3 (ingest lại khi còn job → 409 `chapter_busy`), M1 (dịch lại lỗi giữ page `ready`), M5 (progress chỉ tải job active/24h), M6 (claim không retry). Có test hồi quy.

## Còn lại / rủi ro
- M2: breaker toàn cục tin `error_class` worker gửi — chấp nhận ở MVP invite-only (worker Mac do owner chạy); xem lại ở Phase 8.
- M4: 2 job translate chồng page → job xong sau thắng (có thể ghi bản AI cũ hơn vào `ai_state`; không đụng bản sửa tay).
- M3/M7: ingest complete HEAD tuần tự tới 1000 key trong transaction; ingest chưa có trần bộ nhớ tổng (≈2GB/200 slice).
- Key ảnh ingest theo `ingest_rev` (không theo attempt) — nội dung tất định, DB chỉ nhận attempt hợp lệ.
- Tiêu chí chưa đo thật: golden KO 40 slice với detector thật (chưa có golden), kill -9 đo thời gian thật ≤150s (đã chứng minh bằng lease+reaper trong test), 20000×20000 end-to-end (chặn ở header — test `images.py`), bench LLM thật (chưa có key).

## Câu hỏi mở
- Worker Mac có bao giờ do tenant tự chạy? (quyết định mức tin usage/error_class — M2)
- Huỷ ingest: đã chọn đưa chương về `draft` (commit lại được) — xác nhận.
