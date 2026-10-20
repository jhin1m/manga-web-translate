# Editor (react-konva)

Editor là một phần của **màn chương** gộp: `/w/$ws/s/$seriesId/c/$chapterId[?page=<pageId>][&drawer=export]`
(toàn màn hình, ngoài app shell; route cũ `.../chapters/$c/edit/$pageId` redirect sang `?page=`). Bố cục 4 vùng — rail
trang (trái) | strip canvas Konva liên tục (mỗi page ảo hoá riêng) | inspector (phải) | bảng dưới — xem
[design-guidelines.md](./design-guidelines.md). Code: màn ở `apps/web/src/features/chapter/`, editor ở
`apps/web/src/features/editor/`, API ở `apps/api/src/routes/page-state.ts`.

## Trang đang sửa và cache

Cả chương hiện trên 1 strip nhưng chỉ **1 page active** nằm trong `editorStore` (sửa, undo, autosave như bên dưới);
page khác đọc từ cache `chapterStore.cache` (`chapter-store.ts`). Cache của page active chỉ cập nhật khi rời page (từ
`editorStore.base`) hoặc khi server có version mới (`syncActive`). Page active đổi khi bấm rail/canvas/dòng bảng văn
bản hoặc phím tắt; id phản chiếu vào `?page=`. Store dùng chung cả tab nên mỗi phiên chương bắt đầu bằng `reset()`
(route đặt `key={chapterId}`).

**Đổi thẳng chương → chương** (back/forward): phiên mới reset store ngay lúc render, trước cleanup của phiên cũ. Vì vậy
trước khi reset, sửa chưa lưu của chương cũ được giao cho Saver cũ qua `Saver.flushDetached()` (chụp store lúc gọi →
IndexedDB → PUT; 409 do autosave đang bay → rebase lên bản server rồi PUT lại 1 lần; 423/mạng/xung đột để lại bản
nháp, lần mở sau đề nghị khôi phục) — xem `use-chapter-session.ts`.

## Khoá chương theo trạng thái

Khoá chỉ giữ khi chương **ổn định** (`review` / `partial_failed` / `done`, đã có page; `isChapterSettled` +
`pageIds.length > 0`, `lockEnabled` trong `use-chapter-session.ts`). Chương đang cắt/dịch → không giữ khoá, chỉ xem.
"Dịch chương" / "Dịch lại" / "Chạy lại trang lỗi" đi qua `runAi`: lưu hết (`saver.flush`) → tạm dừng giữ khoá →
nhả khoá (cùng chuỗi `serial` với lock) → gọi API; khoá được lấy lại khi chương ổn định trở lại. Người khác đang giữ
khoá → băng cảnh báo báo tên + "Thử lại", chỉ báo cạnh chip đổi thành "Chỉ xem", editor chỉ xem. Đang giữ khoá
bình thường không có băng (chỉ báo nhỏ icon khoá + "Đã lưu" ở thanh trên).

## Dữ liệu và lưu

- Nguồn sự thật: `page_states.state` (zod `PageState`, `packages/shared/src/page-state.ts`). Store zustand giữ `doc`
  (đang sửa) và `base` + `baseVersion` (bản server đã xác nhận); Konva chỉ render từ store.
- Ghi: `PUT /api/w/:ws/pages/:id/state` với `If-Match: "<version>"`. Không giữ khoá chương → 423 (editor chuyển chỉ
  xem); version lệch → 409 kèm version hiện tại. Mỗi lần ghi đẩy bản cũ vào `page_state_history` (≤ 50/page),
  `state_origin = 'user'`, `ai_update_available` giữ nguyên.
- Autosave (`save.ts`): debounce 2s, lưu ngay khi chuyển page/ẩn tab/rời màn chương. Lượt lưu tuần tự: ghi
  IndexedDB → PUT → 200 xoá bản ghi | 409 tải state server + rebase | 423 chỉ xem (bản ghi giữ lại) và thử lấy lại
  khoá ngay. Rời editor: lượt lưu cuối chạy trong chuỗi `serial` của `use-chapter-lock.ts`, xếp trước lệnh nhả khoá
  (effect autosave khai báo trước `useChapterLock` → cleanup chạy trước); khoá đã mất từ trước → lấy lại, lưu.
  Đóng tab: pagehide không chờ được promise nên không đổi thứ tự được — thay đổi sau lần lưu cuối nằm trong
  IndexedDB (khôi phục lần mở sau).
- Thay đổi chưa lưu (`pending-queue.ts`, DB `mtl-editor`, store `pending`, khoá `pageId`): ghi 300ms sau mỗi thay đổi
  dạng op theo id (`rebase.ts`), không phải immer patch (patch theo chỉ số mảng lệch khi server thêm/xoá box).
  Mở lại page còn bản ghi → banner "Khôi phục / Bỏ"; trong lúc chờ quyết, editor chỉ xem.
- Rebase (`rebase.ts`): field server còn giá trị gốc → áp bản của mình; server đã đổi cùng field → xung đột, giữ bản
  server, liệt kê ở panel "thay đổi chưa áp được" (khôi phục từng mục hoặc bỏ). Không có "ghi đè tất cả".
  Sau rebase lịch sử undo bị xoá (patch cũ không còn khớp).

## Undo/redo

`history.ts`: immer `produceWithPatches`, giữ 200 bước/page; thao tác liên tục cùng key (gõ trong ô, đổi số) trong
1s gộp 1 bước; kéo/đổi khung ghi khi thả. Mọi thao tác (kể cả áp kết quả AI, về bản AI, chèn OCR) đi qua
`store.apply(recipe)`.

## Vẽ chữ (hợp đồng layout)

Theo [typeset-layout-contract.md](./typeset-layout-contract.md): `TextBoxNode` là `Konva.Shape` tự vẽ (không
`Konva.Text`), baseline/x từ `measure.ts` với metric trong `/fonts/manifest.json`, stroke `lineWidth = 2w` vẽ trước,
fill đè. Ngắt dòng/khớp cỡ (`measure.ts`) cùng thuật toán `worker/mtl_pipeline/typeset.py`; khác duy nhất: `\n`
người gõ = xuống dòng. Box có `text` mà `lines` rỗng (find/replace, áp glossary để renderer ngắt lại) → vẽ theo
`layoutBox` lúc hiển thị, không ghi state; export phía server làm y hệt (`render.ensure_lines`). Font: `apps/web/public/fonts/` là bản sao `worker/fonts/` —
`pnpm --filter @mtl/web fonts:sync` sau khi đổi font; `pnpm test` của web fail nếu lệch.

Cờ "tràn khung" (bảng văn bản, rail, inspector, cảnh báo xuất) dùng chung `boxOverflow` trong `measure.ts`, có dung
sai `max(2px, 4% cạnh box theo trục tràn)`: box auto_fit do render.py chọn cỡ, đo lại ở trình duyệt lệch vài phần
nghìn px — không tính là cần xem. "Khối" ở bảng văn bản/đếm/cảnh báo chỉ là vùng chữ; region `bubble` (khung bóng
thoại) vẫn trong state nhưng không thành dòng (`text-table/rows.ts`).

## Ảnh và mask

- Ảnh page tải 1 lần (presigned GET ≤ 15') thành `ImageBitmap`, vẽ theo tile 2048px, chỉ tile trong vùng nhìn ± 1;
  Stage bằng khung nhìn. Layer sạch theo `pages.clean_rev`.
- Mask (B tô, E tẩy) → PNG chỉ phủ vùng có nét (≤ 4096px/cạnh) → `POST /pages/:id/mask-upload` (presigned POST
  PNG ≤ 5MB, key `user-mask/{uuid}.png`) → `POST /pages/:id/reinpaint {user_mask_key, offset, base_clean_rev}`
  (cần khoá; rev cũ → 409) → poll `/jobs/:id` → tải lại page lấy `clean_rev` mới.
- OCR vùng (R): kéo khung → `POST /pages/:id/ocr-region {bbox}` → poll → chèn region + box (thao tác có undo).

## Kết quả AI mới

`ai_update_available` → panel diff theo vùng (bản hiện tại vs AI mới), áp từng vùng/tất cả (giữ vị trí, kiểu chữ
người đã chỉnh). "Đã xem" → `POST /pages/:id/ai-update/ack {ai_rev}` (chỉ tắt cờ nếu đúng rev đã xem).

## Chế độ xem (Gốc / Dịch / Chia đôi)

Thanh trên màn chương: `[Gốc | Dịch | Chia đôi]` (`chapterStore.viewMode`). Gốc = ảnh gốc, ẩn chữ; Dịch = ảnh sạch +
chữ (mặc định); Chia đôi = cột Gốc bên trái cột Dịch trên cùng 1 Stage (cuộn/zoom đồng bộ), chỉ cột Dịch nhận thao
tác — bấm/kéo ở cột Gốc = kéo canvas; trần mount 2 page (mỗi page 2 ảnh). Giữ `O` = tạm xem Gốc, nhả = về chế độ
trước (chia đôi: cột phải cũng hiện gốc, bố cục giữ nguyên). `editorStore.showOriginal` suy ra từ chế độ đang hiện.

Khung nhìn mở chương (và khi bật/tắt Chia đôi): `strip-layout.fitScale` — vừa bề ngang nội dung, trọn chiều cao 1
page dạng tờ (cao ≤ 2× rộng; dải webtoon chỉ vừa bề ngang), trần 100%. Khung đổi cỡ trước khi người dùng động vào
khung nhìn → vừa lại; đã tự zoom → Chia đôi giữ zoom. Hàng công cụ nằm cố định trên canvas (không đè ảnh); góc dưới
"Trang i/N" theo page ở giữa khung. Page chưa `ready` (`pageLevel` busy/todo): cột Dịch hiện ảnh gốc + lớp mờ +
"Đang dịch…"/"Chờ dịch", không vẽ chữ; ảnh sạch vẫn tải ngầm để đổi ngay khi xong. Chế độ Gốc không đổi.

## Phím tắt

Bảng duy nhất ở `apps/web/src/features/editor/shortcuts.ts` (thuần, có test), 1 listener `use-shortcuts.ts` chỉ gắn
khi màn chương mount; bảng tra trong UI: nút `?` trên thanh trên. Phím đơn tắt khi focus trong ô nhập; drawer đang
mở → tắt phím màn chương (Esc đóng drawer).

| Phím | Hành động |
|---|---|
| V · T · B · E · R | Chọn · khung chữ mới · mask · tẩy mask · OCR vùng (OCR đổi từ `O` sang `R`) |
| giữ O · `\` | Tạm xem gốc · đổi Gốc ↔ Dịch |
| A / D · PageUp / PageDown · ← / → | Trang trước / sau (cuộn tới + thành trang đang sửa) |
| Alt+↑ / Alt+↓ | Khối trước / sau theo bảng văn bản (xuyên trang) |
| Ctrl/Cmd+Z · Ctrl/Cmd+Shift+Z · Ctrl+Y | Hoàn tác · làm lại (trang đang sửa; trong ô nhập là hoàn tác của ô) |
| Ctrl/Cmd+S (cả trong ô) | Lưu ngay, chặn hộp lưu của trình duyệt |
| Ctrl/Cmd+F (cả trong ô) | Mở tab Tìm / Thay, focus ô tìm (khi chương đã dịch xong) |
| Enter · Delete · Esc | Sửa chữ box đang chọn (double-click cũng được; Ctrl/Cmd+Enter lưu, Esc huỷ) · xoá box · bỏ chọn |
| ? | Bảng phím tắt |
| Space giữ + kéo (hoặc chuột giữa) | Kéo canvas; cuộn = cuộn strip, Ctrl/Cmd+cuộn = zoom |

## Drawer Xuất / Hoạt động

Drawer phải 420px (`apps/web/src/app/drawer.tsx`): scrim xám, Esc/scrim/Đóng = đóng, focus vào drawer khi mở, trả về
nút đã mở khi đóng.

- **Xuất chương** (`features/chapter/export-drawer.tsx` + `export-panel.tsx`): phạm vi cả chương; ZIP PNG / CBZ (chất
  lượng); "Cắt lại theo slice gốc" (= `layout: original_slices`, bỏ chọn = theo trang); kèm trang chưa dịch; tên file
  `{series}-ch{số}.{zip|cbz}`. Cảnh báo trước khi xuất (`export-warnings.ts`, từ dữ liệu đã có, không gọi API): trang
  lỗi, trang chưa xong, khối tràn khung, khối chưa có bản dịch (bỏ SFX), trang có bản AI mới chưa áp → "Xem các khối
  này" mở bảng lọc "Chỉ khối cần xem". Vẫn xuất được khi có cảnh báo. `?drawer=export` (nút "Xuất lại" ở "Việc cần
  làm") mở chương với drawer Xuất mở sẵn.
- **Hoạt động** (`features/chapter/activity-drawer.tsx`): icon ở thanh trên màn chương, nút ở app shell, kèm số việc
  đang chạy. Upload của tab (mọi chương, thử lại file lỗi); ở màn chương thêm job của chương (trang đang xử lý/lỗi theo
  `error_class`, "Chạy lại trang lỗi") và lượt xuất gần đây (tải lại, huỷ).

## Chưa đo

Hiệu năng page 800×12.000 / 20.000px (mở < 2s, cuộn ≥ 50fps M1), Safari 18, reinpaint ≤ 15s với worker Mac thật.
