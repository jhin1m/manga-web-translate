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
người gõ = xuống dòng. Font: `apps/web/public/fonts/` là bản sao `worker/fonts/` —
`pnpm --filter @mtl/web fonts:sync` sau khi đổi font; `pnpm test` của web fail nếu lệch.

## Ảnh và mask

- Ảnh page tải 1 lần (presigned GET ≤ 15') thành `ImageBitmap`, vẽ theo tile 2048px, chỉ tile trong vùng nhìn ± 1;
  Stage bằng khung nhìn. Layer sạch theo `pages.clean_rev`.
- Mask (B tô, E tẩy) → PNG chỉ phủ vùng có nét (≤ 4096px/cạnh) → `POST /pages/:id/mask-upload` (presigned POST
  PNG ≤ 5MB, key `user-mask/{uuid}.png`) → `POST /pages/:id/reinpaint {user_mask_key, offset, base_clean_rev}`
  (cần khoá; rev cũ → 409) → poll `/jobs/:id` → tải lại page lấy `clean_rev` mới.
- OCR vùng (O): kéo khung → `POST /pages/:id/ocr-region {bbox}` → poll → chèn region + box (thao tác có undo).

## Kết quả AI mới

`ai_update_available` → panel diff theo vùng (bản hiện tại vs AI mới), áp từng vùng/tất cả (giữ vị trí, kiểu chữ
người đã chỉnh). "Đã xem" → `POST /pages/:id/ai-update/ack {ai_rev}` (chỉ tắt cờ nếu đúng rev đã xem).

## Phím tắt

V chọn · T khung chữ mới · B mask · E tẩy mask · O OCR vùng · Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (Ctrl+Y) · Space giữ + kéo
(hoặc chuột giữa) kéo canvas · cuộn = cuộn strip, Ctrl/Cmd+cuộn = zoom · ←/→ chuyển trang · `\` ảnh gốc/bản dịch ·
Enter hoặc double-click sửa chữ (Ctrl/Cmd+Enter lưu, Esc huỷ) · Delete xoá khung · Esc bỏ chọn.

## Chưa đo

Hiệu năng page 800×12.000 / 20.000px (mở < 2s, cuộn ≥ 50fps M1), Safari 18, reinpaint ≤ 15s với worker Mac thật.
