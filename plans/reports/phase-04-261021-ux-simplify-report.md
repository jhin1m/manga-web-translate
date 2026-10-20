# Phase 4 — Thả là dịch: report

Branch `feat/ux-p4-drop-flow` (từ main 6588657). Chưa merge, chưa push.

## Đã làm
- API `PATCH /api/w/:ws/chapters/:chapterId` `{ number?, series_id? }`: series đích tra qua `sdb.byId` (ws khác → 404), trùng số (so theo giá trị số, bỏ qua chính nó) → 409 `chapter_number_taken`, body rỗng/số sai → 400. Mọi trạng thái chương. Test: `chapters.test.ts` ("edit chapter number / series") + case `RESOURCE_CASES`/`BODIES` trong tenant-isolation.
- `upload-manager`: cờ `autoCommit` per chương (`waiting → running → done|failed`), commit khi mọi file lên xong (cả sau "Thử lại ảnh lỗi"); cờ giữ trong dấu localStorage (`auto: true`) → thả lại file sau khi đóng tab vẫn tự dịch. `onCommitted` listener → `router.tsx` invalidate `["chapter", ws, id]` + `["series", ws]`.
- `drop-to-translate.ts`: hàm thuần `resolveDropSeries` (a/b/c/d), `latestChapterSeries`, `dropGroups`, `chapterNumbers` + hook `useDropToTranslate` (home + series page; "+ Ch.N" = series cố định). `readDropped` chuyển từ confirm row sang đây.
- Nút chính/chip/"Việc cần làm": đang chờ tự dịch → nút khoá, title "Tự dịch khi tải xong ảnh (x/y)"; đang commit → "Đang bắt đầu dịch" (chống commit lần 2 → 409). Tự dịch lỗi → thông báo danger, nút "Dịch chương" bật lại; có ảnh bị loại → cảnh báo như bấm tay.
- Header: "Chương N" là nút → popover (select series + số) → PATCH, cập nhật cache detail, invalidate series, đổi series → `navigate replace` sang URL mới.
- Chữ vùng thả home/series đổi theo hành vi mới. Docs: `development-setup.md`, `design-guidelines.md`.

## Quyết định tự chốt (owner ngủ)
1. Zod `ChapterPatch` đặt cạnh `ChapterCreate` trong `apps/api/src/routes/chapters.ts` (thực tế `ChapterCreate` nằm ở đó, không ở `@mtl/shared`) → không có JSON schema nào đổi, không cần `pnpm schema:emit`.
2. Dòng xác nhận (đường dự phòng) cũng bật `autoCommit` — bấm "Tạo và mở chương" đã là thao tác chủ ý; giữ nhất quán "thả là dịch". Form/tuỳ chọn "N chương mỗi ảnh 1 chương" giữ nguyên.
3. Ngoài "không đoán được series", file có vấn đề (sai định dạng, >30MB, >400 file) cũng rơi về dòng xác nhận để hiện lỗi (e2e mới kiểm).
4. Số chương ở đường tự động: số đoán từ tên file (ZIP / 1 ảnh lẻ) nếu chưa có trong series, không thì số trống kế tiếp; nhiều ảnh lẻ = số trang → không đoán. Danh sách chương lấy `fetchQuery(staleTime: 0)` để 2 lần thả liền nhau không trùng số. `defaultNumber` của "+ Ch.N" bỏ ở đường tự động (dùng cùng quy tắc).
5. (c) "chương gần nhất": chương đầu của `/recent-chapters` (cache "Việc cần làm"), dự phòng `latest_chapter.updated_at` lớn nhất từ danh sách series khi cache rỗng (mọi chương đã xuất).
6. PATCH không kiểm khoá chương (đổi metadata, không đụng nội dung trang) và không thêm unique constraint DB cho (series, number) — trùng số chỉ kiểm ở app trong transaction; tạo chương (`POST /chapters`) vẫn cho trùng như trước.
7. "Huỷ giữa chừng không commit": upload-manager không có thao tác huỷ upload; test hiểu là upload dừng giữa chừng (file lỗi) → không commit, thử lại xong → commit.
8. e2e click-budget thả 5 ảnh rồi gọi `/cancel` để không để job ingest treo cho spec sau (worker giả claim mọi job workspace).

## Kiểm chứng
- `pnpm typecheck` xanh; `pnpm lint` xanh (239 file); `pnpm test`: shared 8, web 140, db 3, api 145 — đều xanh.
- `pnpm --filter @mtl/web e2e`: 18/18 xanh (1.1m), gồm test mới: click-budget thả 5 ảnh (0 click), upload-chapter đổi số/series trên header (409 + đổi URL), dự phòng dòng xác nhận khi file lỗi.
- Thủ công Chrome (dev 5180, worker thật): thả 5 webp `demo_manga_eng` ở home → vào thẳng "Chương 6" (series từ chương gần nhất), chip "Đang cắt trang" → "Đang dịch 0/5", không bấm gì thêm. Chương này tốn ngân sách AI thật (chủ ý theo plan).

## Còn mở
- Chương 6 tạo lúc kiểm thủ công nằm ở series của chương gần nhất trên DB dev — owner xem/sửa số hoặc xoá nếu không muốn.
- Tuỳ chọn "N chương, mỗi ảnh 1 chương" giờ chỉ đi được qua dòng xác nhận, mà dòng này chỉ hiện khi không đoán được series → trên workspace đã có chương thì gần như không với tới. Nếu owner cần lại thì thêm lối vào (vd giữ Alt khi thả) — YAGNI đợt này; e2e không còn phủ nhánh này.
- Không có unique constraint (series_id, number): 2 người PATCH/tạo cùng lúc vẫn có thể ra trùng số.
