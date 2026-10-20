# Test report: Phase 6 export / glossary / polish (chưa commit)

Ngày 2026-10-20 · macOS · Node 24 · pnpm · uv · Postgres 17 + MinIO (docker, đang chạy sẵn)
Worktree: `/Users/jhin1m/Desktop/ducanh-project/mtl-wt/p6` · branch `feat/p6-export-glossary-polish`

## Kết quả tổng

| Hạng mục | Lệnh | Kết quả |
|---|---|---|
| Typecheck | `pnpm typecheck` | PASS (shared, db, api, web) |
| Lint | `pnpm lint` (biome) | PASS, 168 file, không fix |
| Unit/integration | `pnpm test` ×2 | PASS cả 2 lượt, 177 test |
| Worker lint | `uv run ruff check .` | PASS |
| Worker format | `uv run ruff format --check .` | PASS, 53 file |
| Worker types | `uv run mypy .` | PASS, 50 file |
| Worker tests | `uv run pytest -q` | 120 passed, 2 skipped |
| Build web | `pnpm --filter @mtl/web build` | PASS, không warning |
| E2E | `pnpm --filter @mtl/web e2e` | 6/6 PASS ×2 lượt cuối (sau khi thêm spec) |

## Chi tiết

**pnpm test** (2 lượt, số test giống nhau → không flaky)
- `packages/shared`: 8 pass (~110 ms)
- `apps/web`: 9 file, 52 pass (~270 ms), gồm `sync-fonts --check`
- `packages/db`: 3 pass (~500 ms)
- `apps/api`: 15 file, 114 pass (~23 s, gần như toàn bộ thời gian là test API)

**Worker**: 2 skip do thiếu weight model, không phải lỗi: `tests/test_inpaint.py:43` (big_lama), `tests/test_tiling_merge.py:69` (rtdetr_v2_comic). Hai test này không được verify trên máy này.

**Build web** (Vite 8.3.4, không warning):

| Chunk | Raw | Gzip |
|---|---|---|
| `index-*.js` | 437.22 kB | 137.44 kB |
| `EditorPage-*.js` (lazy) | 490.88 kB | 149.93 kB |
| `index-*.css` / `EditorPage-*.css` | 9.27 kB / 3.73 kB | 2.44 kB / 1.22 kB |

`EditorPage` nằm sát ngưỡng cảnh báo 500 kB của Vite. Chưa vượt nên chưa có warning.

**E2E**
- Lượt đầu, trước khi thêm spec mới: 3/3 PASS (`editor.spec.ts`, `typeset-parity.spec.ts`, `upload-chapter.spec.ts`), ~22 s.
- Spec mới `apps/web/e2e/chapter-tools.spec.ts`: 3/3 PASS.
- Full suite sau khi thêm spec: 6/6 PASS, 25.9 s và 26.0 s.
- Full suite sau lần sửa kiểu trong fake-worker: 6/6 PASS, 25.9 s và 26.0 s.

## Spec mới `chapter-tools.spec.ts`

Mỗi test dựng một chương 1 trang đã dịch qua upload + fake worker, số chương tăng dần (3001, 3002, 3003).

1. **Tìm & thay**: xem trước hiện "1 chỗ khớp" và bản dịch không đổi. Áp dụng → state đổi thành "Xin Hello" (kiểm qua API). Hoàn tác → trả về "Xin chào".
2. **Áp glossary**: tạo 2 entry glossary series qua API.
   - Entry `없는말` không có trong chữ gốc → "Không có chỗ nào khớp.", nút Áp dụng disabled.
   - Entry `안녕하세요` → 1 chỗ khớp, hiện "quy tắc 1" → áp dụng → "Chào bạn" → hoàn tác → "Xin chào".
3. **Xuất chương**: Xuất (png_zip, original_slices) → fake worker PUT zip kèm đúng `outputs.export.headers` (có `x-amz-tagging`) và complete → trạng thái "Xong" → link "Tải xuống" có `download`. `page.request` với `maxRedirects: 0` → 302, Location có `X-Amz-Signature` và `response-content-disposition` chứa `filename*=UTF-8''Series%20e2e-ch{n}.zip`. Tải presigned URL → 200, bắt đầu bằng `PK`, kích thước khớp `bytes` của API.

Thay đổi `fake-worker.ts` (chỉ thêm): capability `chapter.export`, nhánh `chapter.export` trong `handle`, hàm `putWith` (PUT theo header đã ký), kiểu `outputs` có thêm `key`/`headers`. Hành vi cũ không đổi.

Lỗi trong quá trình viết spec (đã sửa, không phải lỗi sản phẩm):
- Gọi API tạo glossary trước khi đăng nhập → 401. Sửa: login trước.
- Kiểu `Buffer<ArrayBufferLike>` không khớp `BodyInit` trong `putWith`. Sửa: body `Uint8Array<ArrayBuffer>`.

## Lỗi sản phẩm phát hiện

Không phát hiện lỗi trong code sản phẩm qua các lệnh và spec trên. Không sửa code sản phẩm.

## Flaky

Không thấy flaky: `pnpm test` 2/2, full e2e 3 lượt sau cùng đều xanh, chapter-tools chạy 3 lần.

## Concerns (không chặn, cần xem)

1. **Cảnh báo Konva trùng** khi chạy e2e: `[vite] (client) [console.error] Several Konva instances detected` (log trong lượt chạy `typeset-parity`). Nguyên nhân nghi ngờ: spec parity nạp `konva.min.js` UMD bằng `addScriptTag` trong khi bundle app cũng nạp Konva. Không làm test fail, nhưng che lấp cảnh báo thật nếu có. Nên cô lập hoặc lọc console.
2. **`typeset-parity.spec.ts` không được type-check**: `apps/web/tsconfig.json` chỉ `include: ["src", "vite.config.ts"]`. Khi check tay, file này có lỗi TS2307/TS2339 (import động `/src/...`, kiểu `{}` của `page.evaluate`). Playwright vẫn chạy vì chỉ transpile. Cần tsconfig riêng cho e2e hoặc script typecheck e2e.
3. **Độ phủ UI e2e còn hẹp**: chapter-tools chỉ đi `png_zip` + `original_slices`. CBZ, quality, layout `pages`, `include_untranslated` chỉ được kiểm ở unit/API/worker test, không có e2e.
4. **Coverage chưa đo**: repo không có script coverage nên không có số line/branch/function. Không bịa số.
5. **Hai test worker skip** do thiếu weight, nên inpaint và tiling merge chưa được verify trên máy này.
6. **Export test kiểm phần đầu file** (`PK`) và kích thước, chưa kiểm nội dung ảnh trong zip. Layout và typeset được cover bởi `worker/tests/test_export_slices.py` và parity test.

## File đã thay đổi (không commit)

- Mới: `/Users/jhin1m/Desktop/ducanh-project/mtl-wt/p6/apps/web/e2e/chapter-tools.spec.ts`
- Sửa (chỉ thêm): `/Users/jhin1m/Desktop/ducanh-project/mtl-wt/p6/apps/web/e2e/fake-worker.ts`
- Không đổi: `seed.ts` (không cần).
- Artifact đã ignore bởi git: `apps/web/e2e/.state.json`, `apps/web/test-results/`.

## Câu hỏi chưa giải quyết

- Có cần đưa `chapter-tools.spec.ts` vào CI không? `.github/workflows/ci.yml` đang trong diff nhưng chưa kiểm tra ở lượt này.
- Cảnh báo Konva trùng có phải kỳ vọng của harness parity không, hay nên sửa?

Status: DONE_WITH_CONCERNS
Summary: Toàn bộ check (typecheck, lint, pnpm test 2 lần, worker ruff/mypy/pytest, build web, e2e) xanh. Thêm spec `chapter-tools.spec.ts` (Tìm & thay, Áp glossary, Xuất chương → 302) 3/3 xanh, full e2e 6/6 xanh ×2 lượt. Không phát hiện lỗi ở code sản phẩm.
Concerns/Blockers: Cảnh báo "Several Konva instances" trong e2e; `typeset-parity.spec.ts` không được type-check; e2e UI chỉ cover png_zip/original_slices; không có số coverage; 2 test worker skip do thiếu weight model.
