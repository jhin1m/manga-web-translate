# Cook — Phase 6 Export + glossary/find-replace — 2026-10-20

Branch `feat/p6-export-glossary-polish` (worktree p6), commit trên `1fed467`, chưa merge. Phase file: status →
`completed` (plan.md không sửa).

## Đã làm
- **Shared**: `ExportInputs`, output `export`, `PresignedOutput.headers` (header nằm trong chữ ký PUT, optional),
  `EXPORT_FILE`/`EXPORT_RETENTION_DAYS`/`EXPORT_OBJECT_TAG`; JSON Schema emit lại (+ `inputs-chapter-export`). Thay
  đổi hợp đồng đều là thêm.
- **API export**: `routes/export.ts` — POST enqueue (idempotent theo version/clean_rev/status page + options; 409
  `no_pages`, `chapter_busy`), list, GET, `download` 302 → presigned GET 5' + attachment (tên UTF-8 + ASCII), 409 chưa
  xong, 410 quá 7 ngày/object mất, 404 job workspace khác. Claim: inputs chốt state, nền = clean nếu page `ready`, URL
  nền 15'; output PUT ký kèm `content-type` + `x-amz-tagging: mtl-kind=export`. Complete: chỉ nhận đúng key cấp lúc
  claim, `bytes` lấy từ HEAD.
- **Lifecycle**: `minio-init` import rule xoá object tag `mtl-kind=export` sau 7 ngày (đã áp vào MinIO dev đang chạy).
- **Worker**: `mtl_worker/export.py` — tải hết nền ra đĩa tạm, render theo `render.py` (4× rồi thu nhỏ, viền dilate,
  không stroke_width), `render.ensure_lines` (≡ `layoutBox` editor) cho box thiếu lines, layout `pages` /
  `original_slices` (ghép cửa sổ trượt `SliceAssembler`, không giữ cả strip), PNG/JPEG theo quality, zip STORED ra file
  tạm, CBZ + ComicInfo.xml, upload streaming với presign mới + đúng header. Không cần model/LLM.
- **Find/replace + áp glossary**: `routes/find-replace.ts` — preview (không khoá), apply (khoá 423, versions từ preview
  → 409 `preview_stale`, 1 transaction, history chung `batch_id`, `state_origin=user`), undo theo batch (409
  `undo_conflict` khi page bị sửa tiếp). Glossary: glossary gộp (series đè workspace), chỉ thay trong vùng có source
  chứa term + box gắn vùng. Box đổi → `lines: []`; kết quả NFC hoá.
- **Glossary unique** (việc P4 để lại): migration 0002 additive (dedupe giữ bản sửa gần nhất rồi `UNIQUE NULLS NOT
  DISTINCT (workspace_id, series_id, source_term)`) + down tay; 23505 → 409 `duplicate_term`.
- **Web**: `ExportDialog`, `FindReplace` (luồng preview→apply→undo chung, apply gửi đúng input đã xem trước, bỏ
  preview về muộn), `ApplyGlossary`, `Modal`/`text-utils`; cắm vào màn chương. Editor tách chunk lazy (việc P5 để
  lại): chunk chính 907 → 437 kB, `EditorPage` 491 kB. `drawBoxText` vẽ box thiếu lines bằng layout (chỉ hiển thị).
- **Parity**: `scripts/typeset-parity.ts` + `worker/scripts/typeset_parity.py` sinh fixture 10 page_state golden;
  `apps/web/e2e/typeset-parity.spec.ts` dùng `drawBoxText`/`loadFonts` thật của editor; CI chạy riêng spec này.
- Docs: `docs/export-and-batch-edit.md` (mới), cập nhật `job-queue-worker.md`, `editor.md`, `development-setup.md`,
  `typeset-layout-contract.md` (dòng `lines[]`).

## Kiểm
- `pnpm typecheck` ✓, `pnpm lint` ✓, `pnpm test` ✓ (shared 8, db 3, web 52, api 115; tester chạy 2 lần không flaky).
- Worker: ruff/format/mypy ✓, pytest 120 passed, 2 skip (thiếu weight big_lama/rtdetr — không liên quan).
- `pnpm --filter @mtl/web e2e` ✓ 6/6 (parity, chapter-tools mới: find/replace→undo, áp glossary, export→302; 2 spec cũ).
- Parity: 82 dòng, lệch bbox tối đa 1px, 0 vượt ngưỡng; 8 box thiếu lines: dòng + cỡ auto-fit trùng tuyệt đối.
- Smoke thật (DB riêng, đã xoá): API + `mtl-worker` thật + MinIO: CBZ `original_slices` 2 slice gốc 600×1000 /
  600×700 đúng kích thước, chữ VI dấu chồng, viền, box xoay, box thiếu lines đúng; 302 → presigned 300s, attachment.
- Hiệu năng (worker agent, nền trơn, fake client): 100 page 800×4500 — `pages` png_zip 4.3s, RSS 177MB;
  `original_slices` cbz 3.1s, RSS 246MB. Find/replace 50 trang apply < 2s (test).
- Review: code-reviewer 8/10, 0 Critical/High. Đã sửa 4 Medium (race preview/apply; URL nền 15' → tải trước ra đĩa;
  parity thêm box thiếu lines; chặn export khi chương đang xử lý) + Low (NFC sau thay, tên file đủ chữ số, docs/comment
  lệch). Báo cáo: `code-reviewer-261020-p6-export-glossary-polish-review-report.md`,
  `tester-261020-p6-export-glossary-polish-test-report.md`, `fullstack-developer-261020-p6-{worker-export,web}-report.md`.

## Quyết định (mặc định, không hỏi lại)
- Người ngoài workspace gọi `/download` với ws của người khác → 403 (middleware chung, như mọi route; test
  tenant-isolation (a)); job id của workspace khác trong ws của mình → 404. Không lộ tồn tại file.
- "Đánh dấu box bị đổi" = danh sách trong preview/kết quả (link mở editor), không thêm cờ vào schema PageState.
- Áp glossary: người dùng nhập "cụm cũ" cho từng entry (mặc định = term nguồn để bắt chữ chưa dịch); không đoán cụm cũ.
- `quality` chỉ có tác dụng với CBZ (<100 → JPEG); `png_zip` luôn PNG.
- Ảnh golden worker ở `worker/tests/reference/` (`.gitignore` gốc chặn `golden/`).
- File ngoài danh sách phase: `app.ts` (đăng ký route), `queue.ts`/`claim-inputs.ts`/`enqueue.ts`/`idempotency.ts`
  (export), `storage.ts` (tagging), `page-state.ts` (chỉ export `pruneHistory`), `glossary.ts` + migration (việc giao
  thêm), `router.tsx` (lazy), `TextBoxNode.tsx` (fallback vẽ), `queue.test.ts` (fixture: export nay cần chương có page),
  `infra/docker-compose.dev.yml`, `ci.yml`.

## Chưa xác minh / còn lại
- Owner kiểm tay: soi mắt 5 trang thật (parity), export 100 trang thật ≤ 3' / RAM ≤ 3GB trên Mac, mở CBZ trong
  YACReader/Komga, export chương manhwa 40 slice thật (logic đã test + smoke 2 slice).
- Parity chưa gồm box xoay; CI Linux chưa chạy thật (font/Chromium Linux có thể lệch fixture làm trên Mac).
- Production phải cấu hình rule lifecycle tương đương trên bucket (P7).
- Undo có thể chỉ khôi phục một phần nếu history của page đã bị cắt (giữ 50 bản/page) — hiếm, báo 404 khi mất hết.
- Down migration 0002 xoá dòng `__drizzle_migrations` theo `max(id)` như các down trước (chạy đúng thứ tự).
- Cảnh báo "Several Konva instances" trong spec parity (UMD + bundle app) — vô hại.

## Câu hỏi mở
Không.
