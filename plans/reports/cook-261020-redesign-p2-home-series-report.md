# Cook report — redesign P2: Home + series + upload inline

Ngày: 20/10/2026 · Branch: `feat/redesign-p2-home-series` (chưa merge) · Phase: [phase-02](../261020-1944-web-uiux-redesign-chapter-workspace/phase-02-home-series-inline-upload.md) → `completed` (plan.md không đổi).

## Đã làm
**API (chỉ thêm, không migration)**
- `GET /api/w/:ws/recent-chapters?limit=1..100&open=0|1` (`apps/api/src/routes/chapters.ts`): khoá của mình trước → `updated_at desc`; `open=1` bỏ chương đã xuất; item = `chapterSummary` + `series_title`, `page_counts`, `exported`, `lock_holder_is_me`. Query sai → 400.
- `GET /series/:id`: mỗi chương thêm `page_counts {total,ready,failed,busy}` + `exported`.
- `GET /series` (ngoài danh sách plan, additive — hàng series ở Home cần): `exported_count`, `next_number`, `latest_chapter` (+ page_counts).
- "Đã xuất" = status `done` hoặc có job `chapter.export` succeeded (hiện không code nào set `done`).
- `scoped().countBy(table, cols, where)` (`packages/db/src/scoped.ts`): GROUP BY trong SQL, tự lọc workspace — đếm page không kéo cột OCR JSON.
- Test: `chapters.test.ts` describe "recent chapters" (thứ tự, limit, open, khoá, series_title; page_counts/next_number sau ingest giả); `tenant-isolation.test.ts`: recent-chapters A không chứa chương B + countBy chỉ đếm workspace mình.

**Web**
- `upload/upload-manager.ts` (zustand vanilla cấp module): `startNewChapter` resolve `chapterId` ngay, upload nền (4 song song, 3 lần thử, ký lại khi thử lại); upload xong **không** commit; dấu localStorage `mtl.upload.<id>` cho `resumeChapter` (khớp natural sort + bytes, chỉ upload file thiếu); chặn chạy chồng; `beforeunload` khi đang upload.
- `upload/parse-chapter-filename.ts`, `chapter/next-action.ts` (thuần) + test.
- `home/home-page.tsx` (vùng thả lớn + thả bất kỳ đâu, dòng xác nhận, Việc cần làm, series dạng hàng có tìm/"+ Series mới"/"+ Ch.{next}"), `home/new-chapter-confirm-row.tsx` (Enter/Esc; nhiều ZIP = nhiều chương; nhiều ảnh lẻ hỏi 1 hay N chương), `home/todo-list.tsx`, `home/home.css`.
- `series/series-page.tsx` (2 cột, vùng thả "Chương {next}", chip Cần làm/Đã xuất/Tất cả, hàng chương có thanh tiến độ + 1 nút, hàng upload dở nhận thả lại file; `?tab=settings|glossary`), `series-sidebar.tsx`, `series-settings-form.tsx` (tách nguyên form cũ).
- `chapter/chapter-action-button.tsx`, `upload/drop-zone.tsx`, `upload/chapter-upload-status.tsx`, `lib/format.ts`.
- `chapter-page.tsx`: nút "Dịch chương" (disable khi upload chưa xong), nhúng trạng thái upload, bỏ link `/upload`, đổi trạng thái → làm mới danh sách home/series.
- Router: `/` → HomePage, `s/$s` → SeriesPage, `series/$s/upload` → redirect `s/$s`. Xoá `upload-page.tsx`, `series-list-page.tsx`, `series-settings-page.tsx`.
- E2E `upload-chapter.spec.ts` viết lại: thả ZIP ở home → URL chương **trước khi** upload xong (giữ POST storage bằng `page.route`) → "Dịch chương" → worker giả → 10 trang sẵn sàng → home hiện "Tiếp tục sửa"; series: 3 ảnh lẻ → 3 chương liên tiếp + glossary thêm nhanh; redirect trang upload cũ.

## Kiểm chứng
- `pnpm typecheck` ✓ · `pnpm lint` ✓ · `pnpm test` ✓ (shared 8, db 3, web 68, api 141) · e2e đầy đủ 9/9 ✓ (cổng 5181/8797) · worker `uv run pytest` 132 passed, 2 skipped.
- `rg "UploadPage|SeriesListPage|SeriesDetailPage|SeriesSettingsPage" apps/web/src` = 0.
- Code review (`code-reviewer-261020-2039-redesign-p2-home-series-review-report.md`, 7/10) → đã sửa 3 lỗi High: resume chạy chồng mở "Dịch chương" sớm; nhiều ZIP đánh số sai thứ tự; series list kéo mọi page (chuyển sang `countBy`). Đã sửa thêm Medium: ảnh lẻ không lấy số trang làm số chương; bấm "Tạo" lại sau lỗi không tạo trùng.

## Lưu ý / chưa làm
- `docs/development-setup.md` (mục Web) còn nhắc `.../upload` — để P6 (docs), không thuộc file P2.
- Chương nháp tạo qua API (không qua upload-manager, không có dấu) hiện "Dịch chương"; server không biết file nào đã upload. Bấm sẽ báo lỗi `no_valid_files` ngay trên hàng.
- Upload đang chạy ở tab khác hiện là "Upload dở" ở tab này.
- Mỗi tick tiến độ upload render lại cả danh sách (chấp nhận được ở MVP).

## Vòng 2 (controller chốt 20/10/2026)
- **Xuất lại:** chương đã xuất nhưng sau lần export thành công cuối (mốc `created_at` của job export) có ghi `page_states` (`updated_at`) hoặc job `chapter.translate` mới hơn → `reexport: true`, `exported: false`. Chương này hiện lại trong "Việc cần làm" và chip "Cần làm", nút "Xuất lại" (mở màn chương) khi chương ở `review`/`done`; đang dịch hoặc có trang lỗi thì bước đó đi trước. Chưa sửa gì sau lần xuất thì coi là xong. Không đổi schema: thêm `scoped().maxBy` (GROUP BY max), field additive `reexport` ở series detail/list (`latest_chapter`)/recent-chapters. Test: API (sửa sau khi xuất, dịch lại sau khi xuất, xuất lại thì hết việc) + `next-action.test.ts`.
- **Giới hạn 20** của "Việc cần làm": giữ nguyên.
- **`dev-auto-login.test.ts`:** base env bỏ `DEV_AUTO_LOGIN_*` thật → `pnpm test` xanh khi `.env` có biến này (đã chạy với `.env` hiện tại, không xoá biến).
- Gate: typecheck ✓, lint ✓, test ✓ (shared 8, db 3, web 69, api 142), e2e 9/9 ✓ (5181/8797).

Câu hỏi mở: không còn.
