# Báo cáo kiểm thử đầy đủ: batch small-features (nhánh feat/small-features-batch)

Ngày: 2026-10-23 (Asia/Saigon). Môi trường: macOS, zsh, dev docker infra đang chạy (postgres 5442, minio, files-proxy).
Phạm vi: 6 tính năng (phase 01–06). Không sửa source code. Không chạy coverage (không được yêu cầu).

## 1. Tóm tắt kết quả

| # | Bước | Kết quả |
|---|------|---------|
| 1 | `pnpm db:migrate` (dev) | PASS: 13 bản ghi migration, `workspace_fonts` và `pages.skip_changed_at` tồn tại |
| 1b | Down 0012 + 0011 trên temp DB | PASS: cả hai chạy sạch (BEGIN/COMMIT, rc=0) |
| 2 | `pnpm schema:emit` | PASS: rc=0, emit lặp lại không đổi nội dung (idempotent) |
| 3a | `pnpm typecheck` | PASS: shared, db, web, api đều Done |
| 3b | `pnpm lint` (biome) | PASS: 297 file, không lỗi |
| 4 | `pnpm test` (tuần tự, `--workspace-concurrency=1`) | PASS: 449/449 test TS |
| 5a | `uv run pytest` (worker) | PASS: 184 passed |
| 5b | `uv run ruff check .` | PASS: All checks passed |
| 5c | `uv run ruff format --check .` | PASS: 63 file |
| 6 | `pnpm --filter @mtl/web e2e` (Playwright) | PASS: 32 passed (2.0m), 0 failed, 0 skipped |

Tổng: 0 test fail. Không có test bị skip, không có flaky/retry trong e2e.

## 2. Chi tiết từng bước

### 2.1 Migration dev DB
- `pnpm db:migrate` → `migrations applied`.
- Sau migrate: `drizzle.__drizzle_migrations` có 13 bản ghi (max id 16). `workspace_fonts` tồn tại. `pages.skip_changed_at` tồn tại.

### 2.2 Down file (temp DB, không đụng dữ liệu dev)
- Tạo `mtl_downcheck_1792764161` trong container `mtl-dev-postgres-1`.
- Up đầy đủ qua `runMigrations` (migrator thật): OK.
- `0012_workspace_fonts.down.sql` (psql ON_ERROR_STOP=1): `DROP TABLE`, `DELETE 1`, `COMMIT`. rc=0.
- `0011_pages_skip_changed_at.down.sql`: `ALTER TABLE`, `DELETE 1`, `COMMIT`. rc=0.
- Kiểm tra sau down: 11 bản ghi migration (max id 11), `workspace_fonts` không còn, `skip_changed_at` không còn.
- Đã DROP temp DB. Không còn `mtl_downcheck*`.

Lưu ý nghiệp vụ (đã có trong comment file down, ghi lại để rõ):
- Down 0012 không xóa file font trong storage (minio). Object thành mồ côi.
- Series đang trỏ `default_fonts = "custom-…"` sẽ mất font, fallback về font mặc định.

### 2.3 Schema emit
- `pnpm schema:emit` rc=0, ghi 19 file json-schema.
- Chạy lại lần 2: `diff -r` không khác biệt, nên emit idempotent.
- `git status packages/shared` có diff, nhưng đây là diff của batch (chưa commit). Diff trong `region.schema.json` khớp feature: thêm `text_color`, `outline_color` (pattern hex `^#[0-9a-fA-F]{6}$`).
- Hạn chế: không chụp snapshot trước lần emit đầu nên không chứng minh tuyệt đối "không sinh diff mới" so với trạng thái trước. Bằng chứng gián tiếp: idempotent, nội dung khớp feature, test `shared-contracts.test.ts` pass (test này chặn lệch zod vs file đã commit).

### 2.4 Typecheck và lint
- `pnpm typecheck`: 4 workspace đều `Done`, không lỗi.
- `pnpm lint`: `Checked 297 files ... No fixes applied.`

### 2.5 Unit/integration test (`pnpm test`, chạy tuần tự)

| Workspace | File | Test | Kết quả |
|-----------|------|------|---------|
| packages/shared | 4 | 28 | pass |
| apps/web (kèm `sync-fonts --check`: "public/fonts khớp worker/fonts (10 file)") | 31 | 190 | pass |
| packages/db | 1 | 3 | pass |
| apps/api | 27 | 228 | pass (35.34s) |
| **Tổng TS** | **63** | **449** | **0 fail** |

Log không có dòng `skip`, `warn`, `deprecat`, `unhandled`, `error`.

### 2.6 Worker Python
- `uv run pytest -q`: `184 passed in 6.91s`.
- `uv run ruff check .`: `All checks passed!`.
- `uv run ruff format --check .`: `63 files already formatted`.
- Không chạy mypy (có trong dev deps nhưng không nằm trong yêu cầu).

### 2.7 E2E Playwright
- Lệnh: `pnpm --filter @mtl/web e2e` (`playwright test`, workers=1, DB riêng `mtl_test_e2e`, port 8797/5181).
- Kết quả: `32 passed (2.0m)`.
- Log có 1 `console.error` từ Vite: "Several Konva instances detected". Đây là cảnh báo runtime, không làm fail test. Không rõ đã có từ trước batch hay không.
- Spec liên quan batch: `workspace-fonts.spec.ts` (font tùy chỉnh, upload → default → editor → xóa), `chapter-tools.spec.ts` (ẩn/hoàn tác trang), `series-manage.spec.ts` (ignore text + preview + undo), `upload-chapter.spec.ts` (credit bị bỏ ở series), `typeset-parity.spec.ts` (Konva khớp render.py).

## 3. Độ phủ theo tính năng (đối chiếu file mới/đổi)

| Tính năng | Test hiện có | Khoảng trống |
|-----------|--------------|--------------|
| P1 reexport flag (ẩn/khôi phục trang, migration 0011) | `apps/api/test/chapters.test.ts`, `chapter-tools.spec.ts`, `next-action.test.ts` | OK |
| P2 màu chữ/viền worker (`text_color`, `outline_color`) | `worker/tests/test_textcolor.py` (Python) | Editor không đọc `text_color` (theo plan: editor giữ `contrastStroke`). Không có test end-to-end xác nhận màu gốc giữ qua prepare → typeset → hiển thị. |
| P3 email lời mời SMTP | `apps/api/test/invite-email.test.ts` (mock nodemailer), `invite-only-auth.test.ts` | Không có e2e. `apps/api/src/lib/mailer.ts` không import trực tiếp ở test, chỉ qua nodemailer mock. |
| P4 sắp xếp ảnh nguồn | `apps/api/test/chapters.test.ts:380` ("reorder source files before step 1"); `source-rail-model.test.ts` | [!] Không có test cho hook `apps/web/src/features/chapter/use-source-images.ts` và thao tác kéo thả trong `chapter-workspace.tsx`. Không có e2e cho reorder. |
| P5 ignore text whitespace/regex + ẩn retroactive | `packages/shared/test/ignore-text.test.ts`, `series-ignore-apply.test.ts`, `series-manage.spec.ts:135` | OK. `apps/api/src/lib/batch-edit.ts` không có test riêng, được phủ gián tiếp qua `find-replace.test.ts` (apply/undo). |
| P6 font tùy chỉnh workspace (migration 0012, job `fonts`, worker registry) | `fonts-upload.test.ts`, `fonts.test.ts`, `font-metrics.test.ts`, `claim-fonts.test.ts`, `claim-inputs.test.ts`, `worker/tests/test_job_fonts.py`, `test_font_coverage.py`, `workspace-fonts.spec.ts`, `editor/__tests__/fonts.test.ts`, `sync-fonts --check` | OK |

Không chạy coverage nên không có số % line/branch. Các khoảng trống trên dựa trên đối chiếu file/import.

## 4. Vấn đề và rủi ro (không chặn)

1. [!] `apps/web/tsconfig.json` chỉ include `src` và `vite.config.ts`. `pnpm typecheck` không kiểm `apps/web/e2e/`. Các file e2e đã sửa (`fake-worker.ts`, `series-manage.spec.ts`, `upload-chapter.spec.ts`, `workspace-fonts.spec.ts`) không được typecheck. Playwright chỉ transpile nên lỗi kiểu lọt qua. Chưa kiểm tra bằng tsc ad hoc (ngoài phạm vi, không sửa code).
2. [!] Test DB tồn đọng: `mtl_test_db_33bc6126`, `mtl_test_api_33bc6126`, `mtl_test_db_ecda7392`, `mtl_test_api_ecda7392`. Đây là DB test từ lần chạy trước, chưa được dọn. Không ảnh hưởng kết quả hôm nay nhưng tích lũy theo thời gian.
3. Cảnh báo Konva "Several Konva instances detected" trong log e2e (xem 2.7).
4. Log tạm của lần chạy này nằm ở `/private/tmp/claude-501/` (`tc.log`, `lint.log`, `test.log`, `pytest.log`, `e2e.log`), không nằm trong project.
5. Working tree sau khi chạy: vẫn 126 mục thay đổi như trước, không có file rác mới từ e2e.

## 5. Khuyến nghị (ưu tiên)

1. Thêm `apps/web/e2e` vào một tsconfig (hoặc include trong `apps/web/tsconfig.json`) để `typecheck` bắt lỗi kiểu trong e2e.
2. Thêm unit test cho hook `use-source-images.ts` (logic reorder, optimistic update, rollback khi lỗi API), và một e2e reorder ảnh nguồn.
3. Thêm test kiểm `text_color`/`outline_color` đi qua `prepare` → `typeset` (worker) và giữ khi đủ tương phản. Hiện chỉ có test màu ở mức hàm.
4. Thêm test trực tiếp cho `batch-edit.ts` (`previewPages`, `applyBatch`, `undoBatch` với trang bị khóa/409).
5. Dọn các DB `mtl_test_*_<hash>` tồn đọng.
6. Ghi chú vận hành cho down 0012: cần dọn object font trong minio sau khi chạy down.

## 6. Câu hỏi chưa giải quyết

- Editor có cần hiển thị `text_color`/`outline_color` từ worker không? Plan phase 02 ghi "editor chỉ kiểm, không thêm UI". Xác nhận lại ý định sản phẩm.
- Diff `packages/shared/json-schema/*` có đúng là toàn bộ thay đổi kỳ vọng không? Không có snapshot trước emit để so sánh tuyệt đối.
- Konva warning trong e2e có phải do batch hay đã có từ trước? Cần so với nhánh `main`.
- Có cần chạy mypy cho worker (đã cấu hình trong pyproject) như một cổng bắt buộc không?

Status: DONE_WITH_CONCERNS
Summary: Toàn bộ 6 bước pass. Migration dev OK, down 0011/0012 chạy sạch trên temp DB, schema emit idempotent, typecheck và lint sạch, 449 test TS pass, 184 test pytest pass, ruff sạch, 32 e2e pass. Không có lỗi chặn.
Concerns/Blockers: (1) `apps/web/e2e` không được typecheck; (2) thiếu test cho hook reorder ảnh nguồn và cho màu chữ worker end-to-end; (3) DB test tồn đọng `mtl_test_*`; (4) cảnh báo Konva trong log e2e. Chi tiết mục 4–6 và câu hỏi mục 6.
