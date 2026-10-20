# Editor (react-konva)

Màn sửa kết quả 1 page: `/w/$ws/series/$seriesId/chapters/$chapterId/edit/$pageId` (toàn màn hình, ngoài layout
workspace). Code ở `apps/web/src/features/editor/`, API ở `apps/api/src/routes/page-state.ts`.

## Dữ liệu và lưu

- Nguồn sự thật: `page_states.state` (zod `PageState`, `packages/shared/src/page-state.ts`). Store zustand giữ `doc`
  (đang sửa) và `base` + `baseVersion` (bản server đã xác nhận); Konva chỉ render từ store.
- Ghi: `PUT /api/w/:ws/pages/:id/state` với `If-Match: "<version>"`. Không giữ khoá chương → 423 (editor chuyển chỉ
  xem); version lệch → 409 kèm version hiện tại. Mỗi lần ghi đẩy bản cũ vào `page_state_history` (≤ 50/page),
  `state_origin = 'user'`, `ai_update_available` giữ nguyên.
- Autosave (`save.ts`): debounce 2s, lưu ngay khi chuyển page/ẩn tab/bấm "← Chương". Lượt lưu tuần tự: ghi
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

## Chế độ xem

Thanh trên màn chương: `[Gốc | Dịch | Chia đôi]` (`chapterStore.viewMode`). Gốc = ảnh gốc, ẩn chữ; Dịch = ảnh sạch +
chữ (mặc định); Chia đôi = cột Gốc bên trái cột Dịch trên cùng 1 Stage (cuộn/zoom đồng bộ), chỉ cột Dịch nhận thao
tác — bấm/kéo ở cột Gốc = kéo canvas; trần mount 2 page (mỗi page 2 ảnh). Giữ `O` = tạm xem Gốc, nhả = về chế độ
trước (chia đôi: cột phải cũng hiện gốc, bố cục giữ nguyên). `editorStore.showOriginal` suy ra từ chế độ đang hiện.

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
- **Hoạt động** (`features/chapter/activity-drawer.tsx`): nút ở thanh trên màn chương + app shell, kèm số việc đang
  chạy. Upload của tab (mọi chương, thử lại file lỗi); ở màn chương thêm job của chương (trang đang xử lý/lỗi theo
  `error_class`, "Chạy lại trang lỗi") và lượt xuất gần đây (tải lại, huỷ).

## Chưa đo

Hiệu năng page 800×12.000 / 20.000px (mở < 2s, cuộn ≥ 50fps M1), Safari 18, reinpaint ≤ 15s với worker Mac thật.
