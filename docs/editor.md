# Editor (react-konva)

Editor là một phần của **màn chương** gộp: `/w/$ws/s/$seriesId/c/$chapterId[?page=<pageId>][&drawer=export]`
(toàn màn hình, ngoài app shell; route cũ `.../chapters/$c/edit/$pageId` redirect sang `?page=`). Bố cục: rail công cụ
(trái, 64px) | panel ngữ cảnh (288px; 560px cho Bản dịch / Tìm; bấm lại icon đang mở để thu) | canvas Konva từng trang
| cột thumbnail trang (phải, 112px) — xem [design-guidelines.md](./design-guidelines.md#màn-chương). Code: màn ở `apps/web/src/features/chapter/`, editor ở
`apps/web/src/features/editor/`, API ở `apps/api/src/routes/page-state.ts`.

## Trang đang sửa và cache

Cả chương hiện trên 1 strip nhưng chỉ **1 page active** nằm trong `editorStore` (sửa, undo, autosave như bên dưới);
page khác đọc từ cache `chapterStore.cache` (`chapter-store.ts`). Cache của page active chỉ cập nhật khi rời page (từ
`editorStore.base`) hoặc khi server có version mới (`syncActive`). Page active đổi khi bấm thumbnail / pager canvas /
dòng bảng văn bản hoặc phím tắt; id phản chiếu vào `?page=`. Store dùng chung cả tab nên mỗi phiên chương bắt đầu bằng `reset()`
(route đặt `key={chapterId}`).

**Đổi thẳng chương → chương** (back/forward): phiên mới reset store ngay lúc render, trước cleanup của phiên cũ. Vì vậy
trước khi reset, sửa chưa lưu của chương cũ được giao cho Saver cũ qua `Saver.flushDetached()` (chụp store lúc gọi →
IndexedDB → PUT; 409 do autosave đang bay → rebase lên bản server rồi PUT lại 1 lần; 423/mạng/xung đột để lại bản
nháp, lần mở sau đề nghị khôi phục) — xem `use-chapter-session.ts`.

## Khoá chương theo trạng thái

Khoá chỉ giữ khi chương **ổn định** (`prepared` / `review` / `partial_failed` / `done`, đã có page; `isChapterSettled` +
`pageIds.length > 0`, `lockEnabled` trong `use-chapter-session.ts`). Chương đang cắt/dịch → không giữ khoá, chỉ xem.
"Bước 2 · Dịch" / "Dịch lại" / "Chạy lại trang lỗi" đi qua `runAi`: lưu hết (`saver.flush`) → tạm dừng giữ khoá →
nhả khoá (cùng chuỗi `serial` với lock) → gọi API; khoá được lấy lại khi chương ổn định trở lại. Người khác đang giữ
khoá → băng cảnh báo báo tên + "Thử lại", chỉ báo cạnh chip đổi thành "Chỉ xem", editor chỉ xem. Đang giữ khoá
bình thường không có băng (chỉ báo nhỏ icon khoá + "Đã lưu" ở thanh trên).

## Ảnh gốc trước Bước 1, xoá ảnh / trang, ảnh tự bỏ

**Trước Bước 1** (chương chưa có page: nháp, đang cắt, cắt lỗi) cột thumbnail là các ảnh gốc "Ảnh n" theo thứ tự
upload (`source-rail.tsx`, `use-source-images.ts`): ảnh thả trong tab hiện ngay từ Blob local khi còn đang tải (nhãn
"Đang tải" / "Tải lỗi" / "Chưa tải"), còn lại dùng URL ký (`GET …/chapters/:id/source-files`). Bấm = xem lớn ở canvas,
←/→ chuyển ảnh; panel Chọn hiện ảnh đang xem. Xoá / Khôi phục ảnh khi còn sửa được bộ ảnh — menu chuột phải thumbnail
(Shift+F10 / phím Menu khi đang focus) hoặc nút "Xoá ảnh này" / "Khôi phục ảnh này" ở panel Chọn: `PATCH …/chapters/:id/source-files/:fileId {skip}` đặt
`source_files.skip = 'user'` (giữ hàng để hoàn tác và để tải tiếp khớp bộ file); commit/ingest bỏ ảnh `skip`, nút
Bước 1 đếm ảnh còn dùng. Người khác giữ khoá → 423; đã có page → 409.

Đổi thứ tự ảnh (cùng điều kiện `editable`, thứ tự này là thứ tự Bước 1 ghép/cắt): kéo-thả thumbnail (vạch xanh báo chỗ
thả), menu chuột phải "Đưa lên đầu / Lên 1 / Xuống 1 / Đưa xuống cuối", hoặc Alt+↑/↓ trên thumbnail đang focus (focus đi
theo ảnh). Cập nhật lạc quan, lỗi → trả thứ tự cũ + toast; toast "Đã đổi thứ tự" có "Hoàn tác". Ảnh đã xoá vẫn giữ chỗ.
`PUT …/chapters/:id/source-files/order {ids}`: `ids` phải đúng bộ source file của chương (thiếu / thừa / trùng → 400
`source_set_mismatch`), ghi `ord = vị trí`; cùng guard với PATCH skip (423 người khác giữ khoá, 409 `chapter_not_draft`).
Ingest đọc theo `ord` nên worker không đổi. Kéo-thả HTML5 gốc không chạy trên màn cảm ứng — dùng menu.

**Sau Bước 1** "Ẩn trang n" ở menu chuột phải thumbnail hoặc "Ẩn trang này" ở panel Chọn (chưa chọn khối) ẩn trang
(`PATCH /pages/:id {skipped}`, cần giữ khoá; chương đang chạy → 409 `chapter_busy`; trang hiện cuối cùng → 409
`last_page`). Trang ẩn giữ dữ liệu, hiện mờ "Đã ẩn" đúng vị trí trong cột thumbnail; bấm hoặc chuột phải → "Khôi phục
trang n"; không dịch (Bước 2, dịch lại, chạy lại lỗi; dịch thẳng trang ẩn → 409 `page_skipped`), không làm ngữ cảnh trang
bên cạnh, không tính trạng thái/đếm của chương, không bị Tìm/Thay / Áp glossary đụng tới, không xuất. Số trang giữ
số gốc (1, 2, 4…); bộ đếm và "Trang i / n" chỉ đếm trang hiện. Ẩn/khôi phục sau khi đã xuất **không** đánh dấu "cần
xuất lại".

Toast sau khi xoá ảnh / ẩn trang: "Hoàn tác" · **"Luôn bỏ ở series này"** — học ảnh credit của series
(`POST /series/:id/skip-images {source_file_id | page_id}`; từ trang thì học mọi ảnh gốc nằm trọn trong trang theo
`source_map`). Trình duyệt tính dHash 64 bit + kích thước mọi ảnh lúc thả (`image-fingerprint.ts`, ~0,1s/96 ảnh) và
gửi trong `POST /chapters`; ảnh khớp ảnh đã học (Hamming ≤ 6 và tỉ lệ khung lệch ≤ 5%,
`packages/shared/src/dhash.ts`) được tạo sẵn `skip = 'credit'` → thumbnail mờ "Credit · tự bỏ", khôi phục qua menu. Ảnh
đầu/cuối (3 mỗi đầu) lệch width > 10% so với trung vị chương chỉ có nhãn gợi ý "Có thể là credit" (không tự bỏ). Học
từ chối ảnh không có hash (`no_hash`), ảnh gần trơn (≤ 8 hoặc ≥ 56 bit 1 — dễ khớp nhầm trang trắng, `plain_image`),
ảnh chưa tải lên xong (`not_uploaded`, toast có "Thử lại"), trang không chứa trọn ảnh nào (`no_whole_image`); tối đa
100 ảnh/series, khoá hàng series nên bấm 2 lần không học trùng. Ảnh đã học lưu bản sao riêng
(`ws/{ws}/series/{id}/skip/…`, còn khi xoá chương nguồn) và quản lý ở Cài đặt series → "Ảnh tự bỏ" (xoá khỏi danh
sách không đổi chương đã tạo); xoá series dọn cả thư mục đó.

Giới hạn: credit cùng width với trang truyện đã bị ghép vào page lớn sau Bước 1 thì không tự bỏ được (chỉ ẩn cả
trang); credit cùng mẫu nhưng đổi chữ có thể không khớp; chưa có AI phân loại credit.

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
1s gộp 1 bước; kéo/đổi khung ghi khi thả. Mọi thao tác (kể cả áp kết quả AI, "Bỏ chỉnh sửa tay" ở panel Chọn, chèn
OCR, nhân đôi khối) đi qua `store.apply(recipe)`.

## Vẽ chữ (hợp đồng layout)

Theo [typeset-layout-contract.md](./typeset-layout-contract.md): `TextBoxNode` là `Konva.Shape` tự vẽ (không
`Konva.Text`), baseline/x từ `measure.ts` với metric trong `/fonts/manifest.json`, stroke `lineWidth = 2w` vẽ trước,
fill đè. Ngắt dòng/khớp cỡ (`measure.ts`) cùng thuật toán `worker/mtl_pipeline/typeset.py`; khác duy nhất: `\n`
người gõ = xuống dòng. Box có `text` mà `lines` rỗng (find/replace, áp glossary để renderer ngắt lại) → vẽ theo
`layoutBox` lúc hiển thị, không ghi state; export phía server làm y hệt (`render.ensure_lines`). Font: `apps/web/public/fonts/` là bản sao `worker/fonts/` —
`pnpm --filter @mtl/web fonts:sync` sau khi đổi font; `pnpm test` của web fail nếu lệch.

**Font của nhóm** (Cài đặt nhóm → tab Font, `/w/$ws/settings`, owner/admin upload TTF/OTF ≤ 10MB, ≤ 20 font): `loadFonts(fetchCustom)` ở
`fonts.ts` nạp thêm từng font bằng `FontFace(font_id, url(presigned))` (`font_id` = `custom-<8 hex>`), metric
(`units_per_em/ascent/descent`) lấy từ API — API đọc bằng fontkit theo đúng quy tắc `read_metrics` của worker (test parity
với manifest). Danh sách lấy tươi mỗi phiên chương (`staleTime: 0`) nên URL còn hạn; font nạp lỗi (URL hết hạn) → lấy lại danh sách
1 lần rồi nạp lại; không lấy được font nhóm thì editor vẫn chạy với font gói sẵn. Panel Chọn liệt kê thêm nhóm "Font của nhóm".
Box có font không biết (font nhóm đã xoá, state cũ): metric theo font thoại mặc định và `canvasFont` có family dự phòng là font đó
(`"<font_id>", "<mặc định>"`) nên đo và vẽ nhất quán, không lỗi; select hiện `<id> (thiếu)`. Font thoại mặc định của series dùng
được khi là font gói sẵn hoặc font nhóm đã nạp (`kit.knows`).

Cài đặt series (`?tab=settings`, `series-settings-form.tsx`) cũng gọi `loadFonts` để dropdown Font mặc định vẽ mỗi option bằng
chính font đó (`.font-select` bật `appearance: base-select` khi trình duyệt hỗ trợ). Owner/admin có option "+ Tải font lên…"
cuối dropdown: chọn file → `uploadCheckedFont` (cùng kiểm tra đuôi / 10MB / 20 font với Cài đặt nhóm) → font mới được chọn
cho đúng ô, chỉ thành mặc định khi bấm Lưu.

Cờ "tràn khung" (bảng văn bản, cột thumbnail, panel Chọn, cảnh báo xuất) dùng chung `boxOverflow` trong `measure.ts`, có dung
sai `max(2px, 4% cạnh box theo trục tràn)`: box auto_fit do render.py chọn cỡ, đo lại ở trình duyệt lệch vài phần
nghìn px — không tính là cần xem. "Khối" ở bảng văn bản/đếm/cảnh báo chỉ là vùng chữ; region `bubble` (khung bóng
thoại) vẫn trong state nhưng không thành dòng (`text-table/rows.ts`).

## Ảnh và mask

- Ảnh page tải 1 lần (presigned GET ≤ 15') thành `ImageBitmap`, vẽ theo tile 2048px, chỉ tile trong vùng nhìn ± 1;
  Stage bằng khung nhìn. Layer sạch theo `pages.clean_rev`.
- Mask (B tô, E tẩy nét mask; panel Mask có nút đổi "Tô (B)" / "Tẩy nét (E)") → PNG chỉ phủ vùng có nét (≤ 4096px/cạnh) → `POST /pages/:id/mask-upload` (presigned POST
  PNG ≤ 5MB, key `user-mask/{uuid}.png`) → `POST /pages/:id/reinpaint {user_mask_key, offset, base_clean_rev}`
  (cần khoá; rev cũ → 409) → poll `/jobs/:id` → tải lại page lấy `clean_rev` mới.
- OCR vùng (R): kéo khung → `POST /pages/:id/ocr-region {bbox}` → poll → chèn region + box (thao tác có undo).
  "Dịch lại khối" (panel Chọn, thanh nổi) = cùng job trên bbox vùng OCR của khối, thay chữ gốc + bản dịch; khối tự
  thêm (không có vùng OCR) thì nút tắt.

## Kết quả AI mới

`ai_update_available` → panel diff theo vùng (bản hiện tại vs AI mới), áp từng vùng/tất cả (giữ vị trí, kiểu chữ
người đã chỉnh). "Đã xem" → `POST /pages/:id/ai-update/ack {ai_rev}` (chỉ tắt cờ nếu đúng rev đã xem).

## Panel ngữ cảnh và thanh nổi

Rail công cụ (`tool-rail.tsx`, hành vi ở `tool-rail-model.ts`): icon công cụ đặt công cụ + mở panel của nó, bấm lại
icon đang mở → thu panel (công cụ giữ nguyên); "Bản dịch" / "Tìm" chỉ mở/thu panel, không đổi công cụ. Phím V/T/B/E/R
đổi công cụ: panel công cụ đang mở thì nội dung đổi theo, panel đang thu thì giữ thu. Chọn khối khi panel
thu → mở panel công cụ (thường là Chọn; đang ở Bản dịch / Tìm thì giữ; chọn bằng chuột thì mở sau khi nhả chuột để
không làm lệch khối đang kéo). Lưu bị xung đột khi panel thu → mở panel;
danh sách xung đột nằm ở đầu mọi panel; thu panel khi còn xung đột → băng cảnh báo báo số mục + nút "Xem". Panel đang mở nhớ theo trình duyệt (`localStorage mtl.layout =
{ panel }`, `layout-prefs.ts`). Chỉ xem → mọi công cụ trừ Chọn tắt (cả phím T/B/E/R); chương chưa có page → Chữ / Mask / Tẩy / OCR tắt;
chương chưa dịch xong → Tìm tắt.

- **Chọn** (`select-panel.tsx`): có khối — "Trang n · Khối i / tổng · Loại" (loại chỉ đọc), Gốc (OCR), Bản dịch
  (`#cw-translation`, cùng nguồn với bảng), cảnh báo tràn khung, font / cỡ / tự khớp, "Kiểu chữ nâng cao" (thu gọn:
  giãn dòng, lề, căn lề, màu, viền, ẩn khi xuất, "Áp kiểu này cho khối <loại> trong chương" — hỏi xác nhận), Dịch lại
  khối, Xoá khối, link Dịch lại trang này. Chưa có khối — trang + trạng thái + cờ (AI có bản mới, tràn khung, cắt ở
  trần chiều cao, lỗi job + "Chi tiết kỹ thuật"), Dịch lại trang này · Ẩn trang này, "Bỏ chỉnh sửa tay, dùng lại bản
  AI" (khi trang khác bản AI). "AI có bản mới" và xung đột khi lưu luôn ở đầu panel.
- **Chữ / OCR** (`tool-panels.tsx`): gợi ý cách dùng + font khối mới / ngôn ngữ gốc của series (đổi ở Cài đặt series).
- **Mask / Tẩy** (`MaskPanel.tsx`): Tô ↔ Tẩy nét, cỡ bút, "Xoá chữ vùng đã tô", "Bỏ nét".
- **Bản dịch** (560px): bảng văn bản cả chương (xem dưới), lọc "Chỉ khối cần xem" / "Chỉ trang đang mở".
- **Tìm** (560px): segmented "Tìm / Thay" | "Glossary" — xem [export-and-batch-edit.md](./export-and-batch-edit.md).
  Hai đoạn giữ trạng thái khi đổi qua lại / thu panel (kết quả xem trước không mất).

**Thanh nổi cạnh khối** (`block-toolbar.tsx`, `role="toolbar"` "Thao tác khối"): Sửa chữ (mở panel Chọn + focus ô
Bản dịch; Enter / double-click vẫn sửa trực tiếp trên ảnh) · Dịch lại khối · Nhân đôi khối (`actions.duplicateBox`:
id mới, lệch +16px, cùng chữ/kiểu, `region_id = null` → dòng "Tự thêm", 1 bước undo, chỉ ở client tới lần lưu) · Xoá
khối (như phím Delete). Hiện khi có khối chọn, công cụ Chọn, không đang gõ trên ảnh, không chỉ xem, trang không đang
chạy AI và đang xem bản dịch. Vị trí: `page-layout.blockBarPos` — trên khối cách 8px, khối sát mép trên khung nhìn →
dưới khối, kẹp trong bề ngang canvas, theo khối khi cuộn/zoom.

**Bảng văn bản** (`text-table/`): 1 dòng / khối (cột #, Tr., Gốc, Dịch sửa tại chỗ, Loại, Tình trạng),
ảo hoá; bấm dòng → mở trang + chọn khối trên ảnh; Enter / Shift+Enter dòng sau / trước (xuyên trang), Alt+Enter xuống
dòng trong ô, Esc bỏ focus; đồng bộ 2 chiều với canvas và panel Chọn.

## Chế độ xem (Xem gốc / Chia đôi) và khung nhìn

Canvas hiện **từng trang một** (page active); đổi trang ở cột thumbnail, pager "‹ Trang n / M ›" góc dưới trái canvas
hoặc ←/→/A/D — thumbnail (`aria-current`), panel Chọn và `?page=` luôn theo page active (URL không có `?page=` = trang
đầu).

Thanh trên màn chương: nút bật/tắt **Xem gốc** (`aria-pressed` = đang hiện ảnh gốc, kể cả lúc giữ `O`; bấm: Gốc ↔ Dịch,
đang Chia đôi → Gốc) và mục **"Chia đôi gốc / dịch"** trong menu "⋯" (`menuitemcheckbox`; tắt = về Dịch)
(`chapterStore.viewMode`). Gốc = ảnh gốc, ẩn chữ; Dịch = ảnh sạch + chữ (mặc định); Chia đôi = cột Gốc bên trái cột
Dịch trên cùng 1 Stage (cuộn/zoom đồng bộ), chỉ cột Dịch nhận thao tác — bấm/kéo ở cột Gốc = kéo canvas. Giữ `O` =
tạm xem Gốc, nhả = về chế độ trước (chia đôi: cột phải cũng hiện gốc, bố cục giữ nguyên). `editorStore.showOriginal`
suy ra từ chế độ đang hiện.

Khung nhìn mở chương / đổi trang / bật-tắt Chia đôi: `page-layout.pageStartView` + `fitScale` theo **chính page đang
hiện** (không theo page rộng nhất chương) — vừa bề ngang nội dung, trọn chiều cao page dạng tờ (cao ≤ 2× rộng; dải
webtoon chỉ vừa bề ngang), trần 100%, căn giữa ngang, đầu page sát mép trên. Khung đổi cỡ (thu/mở panel) trước khi
người dùng động vào khung nhìn → vừa lại; đã tự zoom (Ctrl/Cmd+cuộn, `chapterStore.zoomed`) → đổi trang / Chia đôi giữ
zoom. Góc dưới phải canvas: **Vừa khung** (khung nhìn mở trang, bỏ cờ zoom) · **100%** (mức 1, đầu trang sát mép
trên, giữ khi đổi trang) — cả hai qua `chapterStore.fitView` — + mức zoom hiện tại. Page đang chạy AI (`pageLevel`
busy): cột Dịch hiện ảnh gốc + lớp mờ + "Đang xử lý…", không vẽ chữ; ảnh sạch vẫn tải ngầm để đổi ngay khi xong.
Page xong bước 1, chờ dịch (`prepared`, "Chờ dịch"): hiện ảnh sạch như thường để soát, sửa mask trước khi bấm Dịch.
Chế độ Gốc không đổi.

## Phím tắt

Bảng duy nhất ở `apps/web/src/features/editor/shortcuts.ts` (thuần, có test), 1 listener `use-shortcuts.ts` chỉ gắn
khi màn chương mount; bảng tra trong UI: phím `?` hoặc "Phím tắt (?)" trong menu "⋯" thanh trên. Phím đơn tắt khi focus trong ô nhập; drawer đang
mở → tắt phím màn chương (Esc đóng drawer).

| Phím | Hành động |
|---|---|
| V · T · B · E · R | Chọn · khung chữ mới · mask · tẩy mask · OCR vùng (OCR đổi từ `O` sang `R`) |
| giữ O · `\` | Tạm xem gốc · đổi Gốc ↔ Dịch (như nút Xem gốc) |
| A / D · PageUp / PageDown · ← / → | Trang trước / sau (cuộn tới + thành trang đang sửa) |
| Alt+↑ / Alt+↓ | Khối trước / sau theo bảng văn bản (xuyên trang) |
| Ctrl/Cmd+Z · Ctrl/Cmd+Shift+Z · Ctrl+Y | Hoàn tác · làm lại (trang đang sửa; trong ô nhập là hoàn tác của ô) |
| Ctrl/Cmd+S (cả trong ô) | Lưu ngay, chặn hộp lưu của trình duyệt |
| Ctrl/Cmd+F (cả trong ô) | Mở panel Tìm ở đoạn "Tìm / Thay", focus ô tìm (khi chương đã dịch xong) |
| Enter · Delete · Esc | Sửa chữ box đang chọn trên ảnh (double-click cũng được; Ctrl/Cmd+Enter lưu, Esc huỷ) · xoá box · bỏ chọn |
| ? | Bảng phím tắt |
| Space giữ + kéo (hoặc chuột giữa) | Kéo canvas; cuộn = cuộn strip, Ctrl/Cmd+cuộn = zoom |

## Drawer Xuất / Hoạt động

Drawer phải 420px (`apps/web/src/app/drawer.tsx`): scrim xám, Esc/scrim/Đóng = đóng, focus vào drawer khi mở, trả về
nút đã mở khi đóng.

- **Xuất chương** (`features/chapter/export-drawer.tsx` + `export-panel.tsx`): phạm vi cả chương; ZIP PNG / CBZ (chất
  lượng); "Cắt lại theo slice gốc" (= `layout: original_slices`, bỏ chọn = theo trang); kèm trang chưa dịch; tên file
  `{series}-ch{số}.{zip|cbz}`. Cảnh báo trước khi xuất (`export-warnings.ts`, từ dữ liệu đã có, không gọi API): trang
  lỗi, trang chưa xong, khối tràn khung, khối chưa có bản dịch (bỏ SFX), trang có bản AI mới chưa áp → "Xem các khối
  này" mở panel Bản dịch lọc "Chỉ khối cần xem". Vẫn xuất được khi có cảnh báo. `?drawer=export` (nút "Xuất lại" ở "Việc cần
  làm") mở chương với drawer Xuất mở sẵn.
- **Hoạt động** (`features/chapter/activity-drawer.tsx`): icon ở thanh trên màn chương, nút ở app shell, kèm số việc
  đang chạy. Upload của tab (mọi chương, thử lại file lỗi); ở màn chương thêm job của chương (trang đang xử lý/lỗi theo
  `error_class`, "Chạy lại trang lỗi", trang chờ AI tự thử lại) và lượt xuất gần đây (tải lại, huỷ).
- **Lỗi job của trang** (`features/chapter/job-error.ts`): lỗi `provider` / `rate_limited` không làm job hỏng ngay —
  queue requeue có backoff (≤ 20 lần, `apps/api/src/jobs/errors.ts`), trang vẫn "Đang xử lý". Màn chương đọc
  `error_class` + `run_after` của job trong `/progress` → băng cảnh báo + thumbnail (viền cam "Chờ AI") + panel Chọn
  ("tự thử lại lúc HH:MM (lần n)"). Job hỏng/huỷ → câu lỗi + "Dịch lại trang này" / "Chạy lại trang lỗi"; lỗi thô trong "Chi
  tiết kỹ thuật".

## Chưa đo

Hiệu năng page 800×12.000 / 20.000px (mở < 2s, cuộn ≥ 50fps M1), Safari 18, reinpaint ≤ 15s với worker Mac thật.
