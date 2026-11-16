# Brainstorm: thả folder + lưới kiểu manga (series, chương)

Ngày: 2026-11-16. Trạng thái: user duyệt thiết kế, chuyển /ak:plan.

## Yêu cầu gốc
1. Thả ảnh / ZIP cho phép thả cả folder, lấy tên folder làm chuẩn.
2. Trang chủ: danh sách series kiểu manga (ảnh bìa + tên).
3. Trang series: danh sách chương kiểu manga (ảnh đầu + tên chương).
4. Hosting server cho user dùng, tự tải model, user gắn key (tham chiếu sau23h.com/shyobox) → **tách brainstorm riêng**, ngoài phạm vi.

## Hiện trạng (scout)
- `apps/web/src/features/upload/drop-zone.tsx`: chỉ đọc `dataTransfer.files` → folder bị bỏ/0 byte. Input file không có `webkitdirectory`.
- `apps/web/src/features/home/drop-to-translate.ts`: `readDropped` → `Dropped {zips, loose}`, `dropGroups` (mỗi ZIP = 1 chương, số đoán từ tên ZIP qua `parseChapterNumber`), `resolveDropSeries` (series cố định → khớp tên → chương gần nhất → series duy nhất), fallback `NewChapterConfirmRow`.
- `features/upload/files.ts`: `isJunkEntry`, `toPageFile`, `collectPages`, giới hạn 30MB/file, 400 file/chương.
- `features/home/home-page.tsx`: `SeriesRows` một dòng/series, icon Sửa/Xoá, xác nhận xoá tại chỗ.
- `features/series/series-page.tsx`: hàng chương (Ch.N, trạng thái, thời gian, progress, "thả lại file để tải tiếp", xoá).
- Schema `packages/db/src/schema/app.ts`: `series` không có cột bìa; `chapters.title` có sẵn (default ""), đang không điền lúc tạo; `source_files.skip` đánh dấu trang credit/ẩn; `ord` thứ tự.
- Storage: facade `apps/api/src/storage.ts` (driver `s3` VPS / `disk` self-host), `presignGet`. API chưa có lib xử lý ảnh. Không có thumbnail: ảnh gốc ≤ 30MB, strip rất cao.
- `chapter-meta-popover.tsx` hiển thị `number · title`, chưa cho sửa title.

## Quyết định đã chốt (user)
| Câu hỏi | Chốt |
|---|---|
| Tên folder dùng làm gì | Folder = 1 chương; folder chứa folder con → mỗi con 1 chương. Series đoán như ZIP |
| Ảnh bìa series | Tự động (trang đầu không skip của chương số nhỏ nhất), đổi được (upload trong cài đặt series + "Dùng ảnh tự động") |
| Bố cục | Lưới thay hẳn danh sách, cả trang chủ lẫn trang series |
| Hosting | Tách bàn sau |

## Quyết định tự chốt (uỷ quyền việc nhỏ)
- **Thumbnail phía API, on-demand, `sharp`, cache vào storage** (`thumbs/{sourceFileId}.webp`, ~300×400, cắt phần trên strip tỉ lệ 3:4; `limitInputPixels`). Endpoint `GET /api/thumbs/:fileId` → tạo nếu thiếu → 302 tới URL ký (hoặc stream, chốt ở plan).
  - Lý do: chương cũ có ngay; chạy cả 2 driver; skip đổi sau thì bìa tự đúng (thumb theo file); bìa upload resize cùng chỗ.
  - Loại: (B) browser tạo lúc thả — chương cũ không có, skip đổi sau thì sai, Safari strip cao không giải mã; (C) ảnh gốc + CSS — vài trăm MB/lưới.
  - Giá: dep native (~30MB image Docker, có prebuilt linux x64/arm64 + macOS).
- **Tên chương từ folder/ZIP**: lưu `chapters.title` = tên đã bỏ tên series + cụm số chương + ký tự nối thừa; rỗng thì chỉ hiện "Ch.N". VD `Chapter 105 - The Return` → "The Return"; `Solo Leveling ch 105` → "". Hàm thuần có test. Áp cho cả ZIP để nhất quán.
- Thêm "Chọn folder" (`webkitdirectory`) cạnh "Chọn file".
- Title sửa được trong `chapter-meta-popover`.
- Icon Sửa/Xoá cố định góc thẻ (không hover-only, không chuột phải — theo memory UX).

## Thiết kế
### 1. Thả folder
- `drop-zone.tsx`: đọc `items[].webkitGetAsEntry()`, duyệt đệ quy (`readEntries` lặp tới hết batch). Trả cấu trúc có đường dẫn tương đối thay vì `File[]` phẳng (hoặc gắn path).
- `Dropped` thêm `folders: {name, pages}[]`; `dropGroups` xử lý folder như ZIP. Folder lồng: folder lá chứa ảnh = 1 chương.
- `resolveDropSeries` nhận thêm tên folder (folder cha + folder chương) để khớp series.
- Folder rỗng / file lỗi / vượt 400 file → fallback dòng xác nhận.
- `createChapter` nhận `title` (API + zod shared).

### 2. Lưới series (trang chủ)
- Thẻ: bìa 3:4 (placeholder khi chưa có chương), tên, chấm trạng thái + "Ch.N · trạng thái", số chương, icon Sửa/Xoá góc.
- API list series trả thêm định danh bìa (`cover_key` tuỳ chỉnh hoặc `cover_file_id` tự động = source file đầu không skip của chương số nhỏ nhất).
- Migration: `series.cover_key text null` (+ down tay). Endpoint upload/xoá bìa; resize bằng sharp.
- Cài đặt series: mục "Ảnh bìa" (tải lên / dùng ảnh tự động).

### 3. Lưới chương (trang series)
- Thẻ: ảnh đầu không skip, "Ch.N", title, trạng thái, thời gian; progress + "thả lại file vào thẻ để tải tiếp" + xoá chuyển vào thẻ.
- API detail series trả `first_file_id` mỗi chương.

## Rủi ro
- `webkitGetAsEntry` phải gọi đồng bộ trong handler drop (item hết hạn sau await) → lấy hết entry trước.
- `readEntries` trả theo lô ~100 → phải lặp.
- Thumbnail lần đầu cho lưới nhiều series: N request song song vào API → giới hạn đồng thời trong API (semaphore) để không ngốn RAM (strip 30MB giải mã lớn); `loading="lazy"` trên img.
- sharp trong image self-host (amd64 + arm64) và VPS systemd: kiểm build CI + `pnpm allowBuilds`.
- Xoá chương/series/source file → dọn thumb cache (hoặc chấp nhận rác, dọn theo prefix khi xoá series/chương).
- Quyền: endpoint thumb phải kiểm file thuộc user (dùng `sdb` scoped).
- Đổi hàng → thẻ: test e2e/tests hiện có tham chiếu `.row-item`, `data-series`, `data-chapter` → cập nhật.

## Tiêu chí xong
- Thả folder `Ch 12/` (40 ảnh) → 1 chương số 12; folder chứa 3 folder con → 3 chương đúng thứ tự.
- Folder rỗng / file lỗi → dòng xác nhận, không crash.
- Trang chủ + trang series hiện lưới ảnh, kể cả dữ liệu cũ; series chưa có chương → placeholder.
- Đổi / bỏ ảnh bìa có hiệu lực ngay.
- Chrome, Edge, Firefox trên Windows.
- `pnpm typecheck && pnpm lint && pnpm test` xanh; test đọc folder, tách tên chương, thumbnail (quyền + cache).

## Ngoài phạm vi
Hosting nhiều người / BYOK, bộ cài Windows, toggle lưới/danh sách, folder 2 cấp tự tạo series.

## Câu hỏi còn mở
- Endpoint thumb: 302 tới URL ký hay stream thẳng (cache header)? → chốt khi plan, tuỳ driver disk.
- Hosting: buổi brainstorm riêng (ai trả tiền máy chạy model, quy mô người dùng, BYOK).
