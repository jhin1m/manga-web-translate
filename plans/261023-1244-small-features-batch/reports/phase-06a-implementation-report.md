# Báo cáo triển khai Phase 6a — font tuỳ chỉnh theo workspace (upload, API, web)

Phạm vi: bước 1, 2, 3, 4, 6 của `phase-06-font-tuy-chinh-workspace.md`. Chưa làm: bước 5 (job inputs, worker), bước 7 (docs worker/deploy, README). Không commit.

## Quy tắc metrics (đã chốt)
Manifest sinh bởi `worker/scripts/font_glyph_check.py` qua `mtl_pipeline/fonts.py`:
- `unitsPerEm` = `head.unitsPerEm`.
- OS/2 có cờ `USE_TYPO_METRICS` (bit 7 `fsSelection`) → `ascent = sTypoAscender`, `descent = -sTypoDescender`, `metricsSource = "OS/2.typo"`; ngược lại `hhea.ascent`, `-hhea.descent`, `"hhea"`.
- `missing` = ký tự trong `vietnamese_chars()` (146 ký tự NFC, sắp theo code point) mà `cmap` không có; `viComplete = missing rỗng`.

TS (`fontkit`, MIT) làm đúng như trên. Test parity so từng số của 9 font gói sẵn với manifest: pass.

Bộ chữ Việt dùng chung: `vietnameseChars()` ở `packages/shared/src/vietnamese-chars.ts` và `vietnamese_chars()` ở worker cùng so với file vàng `worker/fonts/vietnamese-chars.txt` (test TS `packages/shared/test/vietnamese-chars.test.ts`, test Python `test_vietnamese_chars_match_shared_golden_list` trong `worker/tests/test_font_coverage.py`). `sync-fonts` chỉ chép `*.ttf|*.otf|manifest.json` nên file `.txt` không ảnh hưởng `--check` (vẫn xanh).

## Helper cho bước 5 (job inputs)
`apps/api/src/lib/fonts.ts`:
- `resolveCustomFonts(sdb: Scoped, ids: Iterable<string | undefined>): Promise<{ id, file_key, sha256 }[]>` — chỉ trả font `custom-*` có thật trong workspace (bỏ id gói sẵn, id đã xoá/lạ), sắp theo id. Dùng khi dựng `fonts: [{id, url, sha256}]`: ký `presignGet(file_key, INPUT_GET_TTL_S)` cho từng `file_key` để ra `url`. `sdb` là `Scoped` (claim-inputs có `ws` → `scoped(db, ws)`; hoặc truyền `tx` nếu đã có kiểu tương thích — cần `scoped(tx, ws)`).
- `isCustomFontId(id)`, `isKnownFont(sdb, id)`, `unknownFonts(sdb, ids)`, `BUNDLED_FONT_IDS`, `newCustomFontId()`.
- Nguồn id cần gom: translate = `series.defaultFonts` (dialogue/narration/sfx); export = `font_family` của mọi `text_boxes` + `defaultFonts` (tương ứng `translateSettings` ở `jobs/enqueue.ts` đang gán `font`/`narration_font`).

Thứ cần biết:
- `font_id` là cột `workspace_fonts.font_id` (unique toàn cục, `custom-<8 hex>`); worker chỉ nhận `id` này. `sha256` = hash file (hex) → khoá cache worker.
- Object font nằm ở `ws/<ws>/fonts/<uploadId>` (không đuôi file; content-type `application/octet-stream`). Worker phải dò định dạng bằng nội dung (Pillow/fontTools đọc theo magic bytes nên không cần đuôi). API đảm bảo là TTF (`00010000`/`true`) hoặc OTF (`OTTO`), ≤ 10MB, parse được bằng fontkit; WOFF/WOFF2/TTC bị từ chối.
- Metrics: worker tự đọc từ file bằng `read_metrics` (cùng quy tắc, đã có parity), không cần truyền metrics trong job.
- Rủi ro khi deploy chỉ 6a: `series.default_fonts` có thể chứa `custom-*`; `translateSettings` đang đẩy thẳng vào job `font`; worker hiện `font_path()` ném `FileNotFoundError` với id lạ → job lỗi. Bước 5 phải ra trước hoặc cùng lúc, và `font_path` fallback font thoại mặc định (+ log) cho id không biết (box dùng font đã xoá). Phải tăng `PIPELINE_VERSION` và `MIN_PIPELINE_VERSION` khi deploy.
- Xoá font: API chặn 409 khi là mặc định của series, nhưng KHÔNG chặn khi box trong `page_state` còn dùng → export/translate phải chịu được id đã xoá (fallback).
- Presigned GET cho worker: dùng `presignGet(key, ttl)` (≤ 15') như `claim-inputs.ts`; GET list của người dùng dùng TTL 10' (`FONT_URL_TTL_S`).

## API
`apps/api/src/routes/fonts.ts` (mount trong `app.ts`):
- `GET /w/:ws/fonts` (member): `{ fonts: [{ id (=font_id), name, bytes, units_per_em, ascent, descent, metrics_source, vi_complete, missing, url, url_expires_at, created_at }] }`.
- `POST /w/:ws/fonts/upload-url` (admin): body `{ bytes }` (1..10MB) → `{ upload_id, key, url, fields, expires_at }`, 201 (`presignPost`, content-type cố định, policy giới hạn size).
- `POST /w/:ws/fonts` (admin): body `{ key }`. 400 `invalid_key` (key ngoài `ws/<ws>/fonts/`), 409 `not_uploaded`, 400 `too_large` / `not_font` / `corrupt_font` (xoá object), trùng sha256 → 200 trả font có sẵn (xoá object trùng, không xoá object của chính font đó), 409 `limit` (≥ 20 font, xoá object), mới → 201. Race trùng sha256 xử lý qua unique `(workspace_id, sha256)`.
- `DELETE /w/:ws/fonts/:fontId` (admin): 404 nếu không có trong workspace, 409 `in_use` kèm `series: [tên]`, 204 (xoá hàng + object).
- `series.default_fonts` (`POST`/`PATCH /series`): schema chuỗi 1..100 ký tự + `assertKnownFonts` → 400 `unknown_font` nếu không phải font gói sẵn/font của workspace. Đã bỏ `FONT_IDS` (API + web).
- `storage.ts`: thêm `readObject(key)`. `storageKeys.font(ws, uploadId)`.

DB: bảng `workspace_fonts` (migration `0012_workspace_fonts.sql` + `migrations-down/0012_workspace_fonts.down.sql`); thêm cột `metrics_source` ngoài danh sách trong phase để lưu nguồn metrics; không tạo index riêng (unique `(workspace_id, sha256)` đã phủ).

## Web
- `features/fonts/api.ts` (types, `useWorkspaceFonts`, `useBundledFontIds` đọc `/fonts/manifest.json`, `uploadFont`, `deleteFont`, `fontLabel`), `features/fonts/font-settings.tsx`, `routes/workspace-settings.tsx`, route `/w/$ws/settings` trong `app/router.tsx`, link "Cài đặt nhóm" trong menu tài khoản cạnh "Thành viên".
- Tab Font: upload (chỉ owner/admin), kiểm trước đuôi/10MB/20 font, bảng font + cảnh báo "Thiếu dấu: …", icon xoá (409 nêu tên series), thành viên chỉ xem.
- Series: select font thoại/dẫn truyện = gói sẵn + optgroup "Font của nhóm"; sidebar hiện tên font nhóm.
- Editor: `loadFonts(fetchCustom?)` (bản gói sẵn nạp 1 lần/tab, font nhóm nạp mỗi phiên, lỗi URL → lấy lại danh sách 1 lần), `FontKit` thêm `custom`, `knows`; `canvasFont` có family dự phòng là font mặc định nên box có font đã xoá đo/vẽ nhất quán, không lỗi; `dialogueFont(manifest, font, isKnown)`; panel Chọn có optgroup "Font của nhóm"; overlay sửa chữ dùng `canvasFont`.

## Kiểm thử (đều xanh)
- `pnpm --filter @mtl/api test`: 26 file, 224 test (gồm mới `font-metrics.test.ts` 12, `fonts-upload.test.ts`, `fonts.test.ts` sửa lại, tenant-isolation thêm 4 route). Chạy riêng một mình.
- `pnpm --filter @mtl/web test`: 190 test + `sync-fonts --check` khớp (10 file).
- `pnpm --filter @mtl/shared test`: pass. `pnpm typecheck`, `pnpm lint`: sạch. `pytest worker/tests/test_font_coverage.py`: 10 pass.
- E2E `apps/web/e2e/workspace-fonts.spec.ts` (upload `Itim-Regular.ttf` → làm mặc định series → xoá bị chặn → editor hiện font nhóm, `document.fonts.check` đúng → xoá font → box cũ mở được, "(thiếu)", không pageerror): pass. Toàn bộ e2e: 32/32 pass.

## File
Tạo: `apps/api/src/lib/fonts.ts`, `apps/api/src/lib/font-metrics.ts`, `apps/api/src/routes/fonts.ts`, `apps/api/test/{font-metrics,fonts-upload}.test.ts`, `packages/db/migrations/0012_workspace_fonts.sql` (+ snapshot), `packages/db/migrations-down/0012_workspace_fonts.down.sql`, `packages/shared/src/vietnamese-chars.ts`, `packages/shared/test/vietnamese-chars.test.ts`, `worker/fonts/vietnamese-chars.txt`, `apps/web/src/features/fonts/{api.ts,font-settings.tsx}`, `apps/web/src/routes/workspace-settings.tsx`, `apps/web/e2e/workspace-fonts.spec.ts`.
Sửa: `apps/api/{package.json,src/app.ts,src/storage.ts,src/routes/series.ts,test/fonts.test.ts,test/tenant-isolation.test.ts}`, `packages/db/{src/schema/app.ts,migrations/meta/_journal.json}`, `packages/shared/src/{index.ts,storage-keys.ts}`, `worker/tests/test_font_coverage.py`, `apps/web/src/{app/router.tsx,app/app-shell.tsx,features/series/{api.ts,series-settings-form.tsx,series-sidebar.tsx},features/editor/{fonts.ts,use-chapter-session.ts,panels/Properties.tsx,canvas/ChapterCanvas.tsx,__tests__/fonts.test.ts},features/chapter/{chapter-workspace.tsx,select-panel.tsx}}`, `docs/editor.md`, phase-06 (mục "Tiến độ"), `pnpm-lock.yaml`. Thêm dependency `fontkit` + `@types/fontkit` cho `@mtl/api`.

## Câu hỏi còn mở
- Bước 5 có cần chặn đặt font nhóm làm mặc định series cho tới khi worker mới ra không? Hiện không chặn (đã nêu rủi ro ở trên).
