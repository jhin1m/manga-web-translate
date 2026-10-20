# Phase 4 — Thả là dịch

Status: Pending · Branch: `feat/ux-p4-drop-flow` · Context: [plan.md](./plan.md), [docs/development-setup.md](../../docs/development-setup.md) mục Upload

## Vấn đề
Thả 5 ảnh ở home → `NewChapterConfirmRow` (series, số chương, "1 chương gồm N ảnh / N chương") → "Tạo và mở chương" → màn chương nháp → bấm "Dịch chương". Torii: thả → vào editor → 1 nút dịch.

## Yêu cầu
1. **API** `PATCH /api/w/:ws/chapters/:chapterId` body `{ number?, series_id? }` (zod ở `@mtl/shared` cạnh `ChapterCreate`), `requireWorkspace()`, qua `c.get("sdb")`; series đích phải cùng workspace (byId → 404); trùng số trong series → 409 với mã lỗi rõ. Cho phép mọi trạng thái chương (storage key theo id, không theo số — kiểm `packages/shared/src/storage-keys.ts`; nếu export filename dùng số thì export sau sẽ theo số mới, OK). Thêm case vào `RESOURCE_CASES` (`apps/api/test/tenant-isolation.test.ts`) + test ở `apps/api/test/chapters.test.ts`. Đổi zod → `pnpm schema:emit`.
2. **Tự dịch khi upload xong**: `upload-manager.ts` nhận cờ per-chương `autoCommit`; khi mọi file của chương upload xong (và chưa commit) → gọi commit (cùng API nút "Dịch chương" dùng: `POST /chapters/:id/commit`), báo lỗi qua state như nút hiện tại. Upload chạy ngoài cây route nên vẫn chạy khi điều hướng. Commit lỗi (vd file hỏng) → chương ở lại nháp, nút "Dịch chương" như cũ + thông báo.
3. **Home/Series thả file**: xác định series theo thứ tự (a) series cố định (màn series, nút "+ Ch.N"), (b) đoán từ tên file (`parse-chapter-filename.ts`) khớp series có sẵn, (c) series của chương gần nhất (`/recent-chapters`), (d) series duy nhất của workspace. Có series → tạo chương ngay (số = đoán từ tên file nếu có và chưa trùng, ngược lại số kế tiếp), ảnh lẻ = 1 chương, mỗi ZIP = 1 chương (giữ logic `readDropped`), bật `autoCommit`, điều hướng thẳng tới màn chương (nhiều chương → mở chương đầu, các chương khác vẫn upload + tự dịch, hiện ở "Việc cần làm"). Không xác định được series (0 series) → giữ `NewChapterConfirmRow` như cũ (tạo series mới trong đó). Lựa chọn "N chương mỗi ảnh 1 chương" chỉ còn trong dòng xác nhận — không hiện ở đường tự động (YAGNI).
4. **Header màn chương**: tên series + "Chương N" bấm được → popover nhỏ đổi series (select) / số chương (input) → PATCH; cập nhật query cache (`chapters`, `series`, `recent-chapters`), điều hướng URL mới nếu series đổi (route chứa seriesId).
5. Dòng phụ của vùng thả ở home đổi chữ cho đúng hành vi mới (vd "Thả ảnh/ZIP — tự tạo chương và dịch ngay").

## File
- API: `apps/api/src/routes/chapters.ts`, `packages/shared/src/*` (schema chương), `packages/shared/json-schema/` (emit), test API.
- Web: `apps/web/src/features/upload/upload-manager.ts` (+ test), `apps/web/src/features/home/home-page.tsx`, `new-chapter-confirm-row.tsx` (tách hàm thuần "resolve series + số" để test), `apps/web/src/features/series/series-page.tsx`, `apps/web/src/features/chapter/chapter-topbar.tsx`, `apps/web/src/features/chapter/api.ts`.
- e2e: `full-flow.spec.ts`, `click-budget.spec.ts` (ngân sách mới: thả = 1 thao tác tới khi đang dịch), `upload-chapter.spec.ts`; `apps/web/e2e/fake-worker.ts` chỉ đổi nếu cần.
- Docs: `docs/development-setup.md` (dòng "Upload xong **không** tự dịch" → mô tả mới).

## Kiểm chứng
- Unit: resolve series (4 nhánh), upload-manager auto commit (thành công, lỗi commit, huỷ giữa chừng không commit).
- API test PATCH: đổi số, đổi series, trùng số 409, series ws khác 404, tenant case.
- `pnpm typecheck && pnpm lint && pnpm test` + toàn bộ e2e web.
- Thủ công Chrome: thả 5 ảnh `/Users/jhin1m/Downloads/demo_manga_eng/*.webp` ở home (dùng tool file_upload vào input file của vùng thả) → vào thẳng màn chương, tự chuyển sang đang dịch, không bấm gì thêm.

## Rủi ro
- Tự dịch tốn ngân sách AI ngay khi thả — chủ ý (owner chọn hành vi kiểu Torii). Kill-switch ngân sách (`pnpm jobs`) vẫn áp dụng.
- Race: người dùng bấm "Dịch chương" tay đúng lúc auto commit → commit phải idempotent hoặc nút disable khi auto commit đang chạy; kiểm API commit trả gì khi gọi lần 2.
