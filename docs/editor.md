# Editor (react-konva)

Editor là một phần của **màn chương** gộp: `/s/$seriesId/c/$chapterId[?page=<pageId>][&drawer=export]`
(toàn màn hình, ngoài app shell). Bố cục: rail công cụ
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

Khoá theo **tab trình duyệt**, không theo tài khoản: web gửi header `x-tab-id` (uuid trong `sessionStorage`) ở mọi request, holder = `<userId>:<tabId>` (thiếu header → tab `default`). Cùng tài khoản mở chương ở tab thứ hai → tab đó nhận 423 `{error:"chapter_locked"}` và chỉ xem ("Chương đang mở ở tab khác — chỉ xem ở tab này"); đóng tab chỉ nhả khoá của chính tab đó. Response không còn tên người giữ khoá.

Khoá giữ khi chương đã có page và không còn đang cắt trang (`lockable` + `pageIds.length > 0` → `lockEnabled` trong
`use-chapter-session.ts`) — **cả lúc đang dịch**. Chương chưa có page / đang cắt trang → không giữ khoá, chỉ xem. AI không
cần khoá: job dịch vẫn ghi `state` của trang chưa sửa tay dù chương đang khoá (xem [job-queue-worker.md](./job-queue-worker.md#luồng-dịch-chương-xoá-chữ--ocr-rồi-chuỗi-lô-dịch)).
Thay vào đó khoá theo **trang**:

- Trang đang chờ lượt / đang dịch (progress: `translate_queued`, hoặc job dịch còn hoạt động, hoặc đang xoá chữ + OCR) là
  **trang bận** — chỉ xem (`readOnly = "page_busy"`); server cũng chặn: `PUT /pages/:id/state` và `POST /pages/:id/reinpaint`
  trả 409 `page_busy`. Trang đã xong (lô của nó đã complete) sửa bình thường dù các lô sau còn chạy.
- Lưu gặp `page_busy` không phải xung đột phiên bản: bản sửa giữ trong editor + IndexedDB, thanh trên báo "Trang này đang
  dịch — bản sửa được giữ và lưu khi trang dịch xong", và tự lưu khi trang hết bận (AI vừa ghi → 409 phiên bản thì rebase
  như thường). Đổi sang trang khác khi còn bản sửa chờ → cất lại, lưu khi trang đó hết bận.
- `runAi` ("Dịch chương" khi chương đã ở "Chờ dịch", Dịch lại, Dịch N trang, Chạy lại trang lỗi) chỉ lưu hết (`saver.flush`) rồi gọi API,
  **không nhả khoá**; trang vào lượt dịch thành trang bận ngay (làm mới progress sau khi gọi).
- Thao tác ghi hàng loạt cả chương (Tìm/Thay, Áp glossary, hoàn tác) và ẩn / khôi phục trang chỉ khi chương dịch xong:
  chương đang cắt trang / xử lý → 409 `chapter_busy` (UI tắt nút).

Tab khác đang giữ khoá → băng cảnh báo + "Thử lại", chỉ báo cạnh chip đổi thành "Chỉ xem", editor chỉ xem. Đang giữ khoá
bình thường không có băng (chỉ báo nhỏ icon khoá + "Đã lưu" ở thanh trên).

## Dịch chương: nút chính, chọn trang, tiến độ

Nút chính ở thanh trên (`primary-action.ts`) theo trạng thái chương: Tải ảnh → **"Dịch chương"** → "Xuất" (khoá khi đang chạy)
→ "Xuất". "Dịch chương" ở chương nháp = commit (`target: "translated"`) → cắt trang → xoá chữ + OCR → chuỗi lô dịch, chạy nối
một mạch, không cần bấm lần hai. Menu ⋯ của nút có **"Chỉ xoá chữ + OCR (soát trước)"** (commit `target: "prepared"`): dừng ở
"Chờ dịch" để soát mask / OCR rồi bấm "Dịch chương" (chương `prepared`) — lựa chọn này không nhớ theo series. Chương
`partial_failed` → "Chạy lại trang lỗi" (+ Xuất, Dịch lại cả chương); đã xong → "Xuất" (+ "Dịch lại cả chương");
đang chạy → menu "Huỷ xử lý". Gọi dịch (dịch lại, dịch N trang, chạy lại trang lỗi) khi chương còn lượt đang chạy → 409 `translate_running` (thông báo "Đang có lượt
dịch — chờ lượt này xong hoặc huỷ rồi thử lại.").

**Chọn trang để dịch riêng** (`page-selection.ts`, cột thumbnail): ⌘-click (macOS) / Ctrl-click (nơi khác) bật/tắt 1
trang (và làm neo), Shift-click chọn dải từ neo; Esc bỏ chọn. Chỉ chọn được trang hiện, không bận, đã xoá chữ + OCR (chờ
dịch / xong / lỗi lúc dịch). Có chọn → đầu cột hiện "Dịch N trang · Bỏ chọn" (gửi `POST …/translate {page_ids}`, bản sửa tay giữ
nguyên). Trang đã chọn mà vào lượt dịch (bận) tự rơi khỏi lựa chọn. Một trang: panel Chọn có "Dịch trang này" (trang chờ
dịch) / "Dịch lại trang này" (trang đã dịch hoặc lỗi lúc dịch); trang bận không có nút.

**Tiến độ**: chip trạng thái ở thanh trên — "Đang cắt trang", "Xoá chữ + OCR x/y", "Đang dịch · x/y trang · lô k/n", "Chờ dịch",
"Chờ duyệt · n cần xem", "Xong" (`status.ts`). Thumbnail trang (`page-status.ts` `thumbMark`): "Chờ xoá chữ" / "Xoá chữ" +
%, "Chờ lượt · lô k" (trang của lô sau), "Đang dịch" / "Đang đặt chữ" + % (trang của lô đang chạy), "Chờ AI" (provider tự thử
lại), "Lỗi", "Cần xem", "Đã ẩn". Nhãn bước tiếng Việt cho thumbnail, cột ảnh gốc ("Đã tải" / "Đang tải" / "Chờ" khi cắt trang) và
drawer Hoạt động lấy từ `stage-labels.ts` (mã lạ → "Đang xử lý", không lộ mã tiếng Anh); progress poll 2,5s.

## Ảnh gốc trước khi cắt trang, xoá ảnh / trang, ảnh tự bỏ

**Trước khi cắt trang** (chương chưa có page: nháp, đang cắt, cắt lỗi) cột thumbnail là các ảnh gốc "Ảnh n" theo thứ tự
upload (`source-rail.tsx`, `use-source-images.ts`): ảnh thả trong tab hiện ngay từ Blob local khi còn đang tải (nhãn
"Đang tải" / "Tải lỗi" / "Chưa tải"), còn lại dùng URL ký (`GET …/chapters/:id/source-files`). Bấm = xem lớn ở canvas,
←/→ chuyển ảnh; panel Chọn hiện ảnh đang xem. Xoá / Khôi phục ảnh khi còn sửa được bộ ảnh — menu chuột phải thumbnail
(Shift+F10 / phím Menu khi đang focus) hoặc nút "Xoá ảnh này" / "Khôi phục ảnh này" ở panel Chọn: `PATCH …/chapters/:id/source-files/:fileId {skip}` đặt
`source_files.skip = 'user'` (giữ hàng để hoàn tác và để tải tiếp khớp bộ file); commit/ingest bỏ ảnh `skip`, nút
nút "Dịch chương" đếm ảnh còn dùng. Chương đang mở ở tab khác → 423; đã có page → 409.

Đổi thứ tự ảnh (cùng điều kiện `editable`, thứ tự này là thứ tự ghép/cắt trang): kéo-thả thumbnail (vạch xanh báo chỗ
thả), menu chuột phải "Đưa lên đầu / Lên 1 / Xuống 1 / Đưa xuống cuối", hoặc Alt+↑/↓ trên thumbnail đang focus (focus đi
theo ảnh). Cập nhật lạc quan, lỗi → trả thứ tự cũ + toast; toast "Đã đổi thứ tự" có "Hoàn tác". Ảnh đã xoá vẫn giữ chỗ.
`PUT …/chapters/:id/source-files/order {ids}`: `ids` phải đúng bộ source file của chương (thiếu / thừa / trùng → 400
`source_set_mismatch`), ghi `ord = vị trí`; cùng guard với PATCH skip (423 chương đang mở ở tab khác, 409 `chapter_not_draft`).
Ingest đọc theo `ord` nên worker không đổi. Kéo-thả HTML5 gốc không chạy trên màn cảm ứng — dùng menu.

**Sau khi cắt trang** "Ẩn trang n" ở menu chuột phải thumbnail hoặc "Ẩn trang này" ở panel Chọn (chưa chọn khối) ẩn trang
(`PATCH /pages/:id {skipped}`, cần giữ khoá; chương đang chạy → 409 `chapter_busy`; trang hiện cuối cùng → 409
`last_page`). Trang ẩn giữ dữ liệu, hiện mờ "Đã ẩn" đúng vị trí trong cột thumbnail; bấm hoặc chuột phải → "Khôi phục
trang n"; không dịch (dịch chương, dịch lại, chạy lại lỗi; dịch thẳng trang ẩn → 409 `page_skipped`), không làm ngữ cảnh trang
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

Giới hạn: credit cùng width với trang truyện đã bị ghép vào page lớn lúc cắt trang thì không tự bỏ được (chỉ ẩn cả
trang); credit cùng mẫu nhưng đổi chữ có thể không khớp; chưa có AI phân loại credit.

## Dữ liệu và lưu

- Nguồn sự thật: `page_states.state` (zod `PageState`, `packages/shared/src/page-state.ts`). Store zustand giữ `doc`
  (đang sửa) và `base` + `baseVersion` (bản server đã xác nhận); Konva chỉ render từ store.
- Ghi: `PUT /api/pages/:id/state` với `If-Match: "<version>"`. Không giữ khoá chương → 423 (editor chuyển chỉ
  xem); version lệch → 409 kèm version hiện tại; trang đang dịch / chờ lượt → 409 `page_busy` (bản sửa được giữ, xem "Khoá chương theo trạng thái"). Mỗi lần ghi đẩy bản cũ vào `page_state_history` (≤ 50/page),
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

**Font gói sẵn theo ngôn ngữ**: manifest ghi `langs` mỗi font = ngôn ngữ đích vẽ đủ chữ (`font_langs` ở
`worker/mtl_pipeline/fonts.py`, bảng chữ `target_lang_chars`). Mọi font gói sẵn có `vi/en/id`; font mặc định có đủ 6
ngôn ngữ (`worker/tests/test_font_coverage.py`). Dropdown font của panel Chọn (`kit.idsFor(target_lang)`) và Font mặc
định ở cài đặt series (`useBundledFonts().ids(target_lang)`) chỉ liệt kê font hợp ngôn ngữ đích; font đang dùng mà
không hợp vẫn hiện, ghi `(thiếu chữ …)`. Không chặn ở API/worker — chỉ là gợi ý. Bộ font scanlation Việt hoá
(WildWords, Augie, Mighty Zeo, Felt… từ bộ TeddyBear/iCiel và MTO) thiếu chữ es/pt/fr nên chỉ hiện cho series vi/en/id;
một số file đã được sửa metric dọc lúc thêm vào (bảng `typo` Việt hoá hỏng → bỏ cờ `USE_TYPO_METRICS` hoặc sửa dấu
`sTypoDescender`), nên khi thay file phải kiểm lại khoảng cách dòng.

**Font của bạn** (Cài đặt chung → tab Font, `/settings`, upload TTF/OTF ≤ 10MB, ≤ 20 font): `loadFonts(fetchCustom)` ở
`fonts.ts` nạp thêm từng font bằng `FontFace(font_id, url(presigned))` (`font_id` = `custom-<8 hex>`), metric
(`units_per_em/ascent/descent`) lấy từ API — API đọc bằng fontkit theo đúng quy tắc `read_metrics` của worker (test parity
với manifest). Danh sách lấy tươi mỗi phiên chương (`staleTime: 0`) nên URL còn hạn; font nạp lỗi (URL hết hạn) → lấy lại danh sách
1 lần rồi nạp lại; không lấy được font tuỳ chỉnh thì editor vẫn chạy với font gói sẵn. Panel Chọn liệt kê thêm nhóm "Font của bạn".
Box có font không biết (font tuỳ chỉnh đã xoá, state cũ): metric theo font thoại mặc định và `canvasFont` có family dự phòng là font đó
(`"<font_id>", "<mặc định>"`) nên đo và vẽ nhất quán, không lỗi; select hiện `<id> (thiếu)`. Font thoại mặc định của series dùng
được khi là font gói sẵn hoặc font tuỳ chỉnh đã nạp (`kit.knows`).

Cài đặt series (`?tab=settings`, `series-settings-form.tsx`) cũng gọi `loadFonts` để dropdown Font mặc định vẽ mỗi option bằng
chính font đó (`.font-select` bật `appearance: base-select` khi trình duyệt hỗ trợ). Dropdown có option "+ Tải font lên…"
cuối dropdown: chọn file → `uploadCheckedFont` (cùng kiểm tra đuôi / 10MB / 20 font với Cài đặt chung) → font mới được chọn
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
icon đang mở → thu panel (công cụ giữ nguyên); "Bản dịch" / "Tìm" / "Hiệu đính" chỉ mở/thu panel, không đổi công cụ. Phím V/T/B/E/R
đổi công cụ: panel công cụ đang mở thì nội dung đổi theo, panel đang thu thì giữ thu. Chọn khối khi panel
thu → mở panel công cụ (thường là Chọn; đang ở Bản dịch / Tìm thì giữ; chọn bằng chuột thì mở sau khi nhả chuột để
không làm lệch khối đang kéo). Lưu bị xung đột khi panel thu → mở panel;
danh sách xung đột nằm ở đầu mọi panel; thu panel khi còn xung đột → băng cảnh báo báo số mục + nút "Xem". Panel đang mở nhớ theo trình duyệt (`localStorage mtl.layout =
{ panel }`, `layout-prefs.ts`). Chỉ xem → mọi công cụ trừ Chọn tắt (cả phím T/B/E/R); chương chưa có page → Chữ / Mask / Tẩy / OCR tắt;
chương chưa dịch xong → Tìm, Hiệu đính tắt.

- **Chọn** (`select-panel.tsx`): có khối — "Trang n · Khối i / tổng · Loại" (loại chỉ đọc), Gốc (OCR), Bản dịch
  (`#cw-translation`, cùng nguồn với bảng), cảnh báo tràn khung, font / cỡ / tự khớp, "Kiểu chữ nâng cao" (thu gọn:
  giãn dòng, lề, căn lề, màu, viền, ẩn khi xuất, "Áp kiểu này cho khối <loại> trong chương" — mọi trang, kể cả trang
  đang mở, ghi trong 1 lượt `PUT /chapters/:id/states` chung `batch_id`; toast "Hoàn tác" khôi phục cả lượt qua
  `find-replace/undo`, Cmd+Z không tách lượt này theo trang; chương đang xử lý → 409 `chapter_busy`), Dịch lại
  khối, Xoá khối, link Dịch trang này / Dịch lại trang này (không có khi trang bận). Chưa có khối — trang + trạng thái + cờ (AI có bản mới, tràn khung, cắt ở
  trần chiều cao, lỗi job + "Chi tiết kỹ thuật"), Dịch trang này / Dịch lại trang này · Ẩn trang này, "Bỏ chỉnh sửa tay, dùng lại bản
  AI" (khi trang khác bản AI). "AI có bản mới" và xung đột khi lưu luôn ở đầu panel.
- **Chữ / OCR** (`tool-panels.tsx`): gợi ý cách dùng + font khối mới / ngôn ngữ gốc của series (đổi ở Cài đặt series).
- **Mask / Tẩy** (`MaskPanel.tsx`): Tô ↔ Tẩy nét, cỡ bút, "Xoá chữ vùng đã tô", "Bỏ nét".
- **Bản dịch** (560px): bảng văn bản cả chương (xem dưới), lọc "Chỉ khối cần xem" / "Chỉ trang đang mở".
- **Tìm** (560px): segmented "Tìm / Thay" | "Glossary" — xem [export-and-batch-edit.md](./export-and-batch-edit.md).
  Hai đoạn giữ trạng thái khi đổi qua lại / thu panel (kết quả xem trước không mất).

- **Hiệu đính** (560px, `proofread-panel.tsx`): xem mục [AI hiệu đính](#ai-hiệu-đính).

**Thanh nổi cạnh khối** (`block-toolbar.tsx`, `role="toolbar"` "Thao tác khối"): Sửa chữ (mở panel Chọn + focus ô
Bản dịch; Enter / double-click vẫn sửa trực tiếp trên ảnh) · Dịch lại khối · Nhân đôi khối (`actions.duplicateBox`:
id mới, lệch +16px, cùng chữ/kiểu, `region_id = null` → dòng "Tự thêm", 1 bước undo, chỉ ở client tới lần lưu) · Xoá
khối (như phím Delete). Hiện khi có khối chọn, công cụ Chọn, không đang gõ trên ảnh, không chỉ xem, trang không đang
chạy AI và đang xem bản dịch. Vị trí: `page-layout.blockBarPos` — trên khối cách 8px, khối sát mép trên khung nhìn →
dưới khối, kẹp trong bề ngang canvas, theo khối khi cuộn/zoom.

**Bảng văn bản** (`text-table/`): 1 dòng / khối (cột #, Tr., Gốc, Dịch sửa tại chỗ, Loại, Tình trạng),
ảo hoá; bấm dòng → mở trang + chọn khối trên ảnh; Enter / Shift+Enter dòng sau / trước (xuyên trang), Alt+Enter xuống
dòng trong ô, Esc bỏ focus; đồng bộ 2 chiều với canvas và panel Chọn.

## AI hiệu đính

Panel "Hiệu đính" của rail (`proofread-panel.tsx`, trạng thái thuần ở `proofread-model.ts`): "Chạy AI hiệu đính" /
"Hiệu đính lại cả chương" (lưu hết trước, `POST …/proofread`; tắt khi chương chưa dịch xong hoặc đang chạy; poll 2,5s
khi job chạy) → danh sách gợi ý theo trang rồi thứ tự khối: "Trang n · Khối i" (bấm = mở trang + chọn khối), bản AI
đã đọc (gạch) → đề xuất, lý do, Nhận · Bỏ. Trạng thái suy từ bản dịch hiện tại của khối (cùng nguồn với bảng văn
bản): = bản đã đọc → "Chờ duyệt"; = đề xuất → "Đã nhận"; khác cả hai / khối không còn → "Lỗi thời" (chỉ Bỏ).
**Nhận** = mở trang của khối rồi `setRegionTranslation` qua `editorStore.apply` (như gõ ở bảng: 1 bước hoàn tác,
autosave, version, khoá chương, ngắt dòng lại box; hoàn tác → gợi ý về "Chờ duyệt"). "Nhận tất cả ở trang này" = mọi
gợi ý chờ duyệt của trang đang mở trong 1 bước hoàn tác (editor chỉ sửa 1 trang mỗi lúc). **Bỏ** =
`PATCH /proofread-suggestions/:id {dismissed: true}` (ẩn khỏi danh sách). Chỉ xem → Nhận, Bỏ, chạy lại đều tắt (lượt
mới thay toàn bộ gợi ý, kể cả lượt Bỏ của người khác). Lỗi job viết cho người (`describeJobError`: chờ AI tự thử lại,
vượt ngân sách, lỗi + "Chi tiết kỹ thuật"); Nhận không được (trang chỉ xem / chưa mở được) → báo tại panel. Sửa sau lần xuất cuối
→ "Xuất lại" như mọi lần sửa khác.

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
Page đã xoá chữ + OCR, chờ dịch (`prepared`, "Chờ dịch"): hiện ảnh sạch như thường để soát, sửa mask trước khi bấm Dịch.
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

- **Xuất chương** (`features/chapter/export-drawer.tsx` + `export-panel.tsx`): phạm vi cả chương. Từ trên xuống: cảnh báo
  "Trước khi xuất" (nói hậu quả trong file, xem [export-and-batch-edit.md](./export-and-batch-edit.md#drawer-xuất-chương))
  → "Tuỳ chọn" (thu gọn, 1 dòng tóm tắt: định dạng, cách chia ảnh, chất lượng, có đưa trang chưa dịch) → nút **"Tải chương
  (.zip|.cbz)"** (tiến độ ngay tại nút, xong tự tải; link "Tải xuống" tại chỗ phòng trình duyệt chặn) → "Lượt xuất
  trước" (thu gọn). Đóng drawer giữa chừng không mất việc: xong lúc drawer đóng → thông báo "Đã xuất xong." + "Tải xuống".
  Cảnh báo tính từ dữ liệu đã có (`export-warnings.ts`, không gọi API); "Xem N chỗ này" mở panel Bản dịch lọc "Chỉ khối cần
  xem". Vẫn xuất được khi có cảnh báo. `?drawer=export` (nút "Xuất lại" ở home / danh sách chương) mở chương với drawer Xuất mở sẵn.
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
