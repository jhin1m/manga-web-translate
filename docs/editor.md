# Editor (react-konva)

Editor là một phần của **màn chương** gộp: `/s/$seriesId/c/$chapterId[?page=<pageId>][&drawer=export]`
(toàn màn hình, ngoài app shell). Bố cục: rail công cụ
(trái, 48px, 5 nút) | panel ngữ cảnh (panel khối 272px đóng mặc định, đè lên canvas; panel Văn bản 560px với 4 tab, chiếm cột) | canvas Konva từng trang
| cột thumbnail trang (phải, 72px) — xem [design-guidelines.md](./design-guidelines.md#màn-chương). Code: màn ở `apps/web/src/features/chapter/`, editor ở
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
bình thường không có băng và không có chỉ báo (chỉ hiện "Đang lưu…" / "Chưa lưu" / "Lỗi lưu" khi cần; chữ "Bạn đang giữ khoá chương · Đã lưu" dành cho trình đọc màn hình).

## Dịch chương: nút chính, chọn trang, tiến độ

Nút chính ở thanh trên (`primary-action.ts`) theo trạng thái chương: Tải ảnh → **"Dịch chương"** → "Huỷ" (khi đang chạy)
→ "Xuất". "Dịch chương" ở chương nháp = commit (`target: "translated"`) → cắt trang → xoá chữ + OCR → chuỗi lô dịch, chạy nối
một mạch, không cần bấm lần hai. Menu ⋯ của nút có **"Chỉ xoá chữ + OCR (soát trước)"** (commit `target: "prepared"`): dừng ở
"Chờ dịch" để soát mask / OCR rồi bấm "Dịch chương" (chương `prepared`) — lựa chọn này không nhớ theo series. Chương
`partial_failed` → "Chạy lại N trang" (N = số trang lỗi; "Xuất" và "Dịch lại cả chương" vào menu ⋯); đã xong → "Xuất" (+ "Dịch lại
cả chương" trong ⋯); đang chạy → nút chính "Huỷ" (+ vạch tiến độ 2px ở đáy thanh trên). Gọi dịch (dịch lại, dịch N trang, chạy lại trang lỗi) khi chương còn lượt đang chạy → 409 `translate_running` (thông báo "Đang có lượt
dịch — chờ lượt này xong hoặc huỷ rồi thử lại.").

**Chọn trang để dịch riêng** (`page-selection.ts`, cột thumbnail): ⌘-click (macOS) / Ctrl-click (nơi khác) bật/tắt 1
trang (và làm neo), Shift-click chọn dải từ neo; Esc bỏ chọn. Chỉ chọn được trang hiện, không bận, đã xoá chữ + OCR (chờ
dịch / xong / lỗi lúc dịch). Có chọn → đầu cột hiện "Dịch N trang · Bỏ chọn" (cột không còn đầu "N trang" / lọc "Cần xem") (gửi `POST …/translate {page_ids}`, bản sửa tay giữ
nguyên). Trang đã chọn mà vào lượt dịch (bận) tự rơi khỏi lựa chọn. Một trang: menu trang của trang đang mở
có "Dịch trang n" (trang chờ dịch) / "Dịch lại trang n" (trang đã dịch hoặc lỗi lúc dịch); trang bận không có mục này.

**Tiến độ**: chip trạng thái ở thanh trên — "Đang cắt trang", "Xoá chữ + OCR x/y", "Đang dịch · x/y trang · lô k/n", "Chờ dịch",
"Chờ duyệt · n cần xem", "Xong" (`status.ts`). Thumbnail trang không chữ: `thumbMark` cho viền + thanh %, `thumbFlag` cho cờ góc ("!" / "×"), tên truy cập (`thumbAria`) và tooltip (`thumbTitle`) mang nhãn: "Chờ xoá chữ" / "Xoá chữ" +
%, "Chờ lượt · lô k" (trang của lô sau), "Đang dịch" / "Đang đặt chữ" + % (trang của lô đang chạy), "Chờ AI" (provider tự thử
lại), "Lỗi", "Cần xem", "Đã ẩn". Nhãn bước tiếng Việt cho thumbnail, cột ảnh gốc ("Đã tải" / "Đang tải" / "Chờ" khi cắt trang) và
drawer Hoạt động lấy từ `stage-labels.ts` (mã lạ → "Đang xử lý", không lộ mã tiếng Anh); progress poll 2,5s.

## Ảnh gốc trước khi cắt trang, xoá ảnh / trang, ảnh tự bỏ

**Trước khi cắt trang** (chương chưa có page: nháp, đang cắt, cắt lỗi) cột thumbnail là các ảnh gốc "Ảnh n" theo thứ tự
upload (`source-rail.tsx`, `use-source-images.ts`): ảnh thả trong tab hiện ngay từ Blob local khi còn đang tải (cờ ở góc
thumbnail + tooltip "Đang tải" / "Tải lỗi" / "Chưa tải"), còn lại dùng URL ký (`GET …/chapters/:id/source-files`). Bấm = xem lớn ở canvas,
←/→ chuyển ảnh. Xoá / Khôi phục ảnh khi còn sửa được bộ ảnh — menu chuột phải thumbnail
(Shift+F10 / phím Menu khi đang focus) hoặc nút góc thumbnail (hiện khi rê chuột / focus): `PATCH …/chapters/:id/source-files/:fileId {skip}` đặt
`source_files.skip = 'user'` (giữ hàng để hoàn tác và để tải tiếp khớp bộ file); commit/ingest bỏ ảnh `skip`, nút
nút "Dịch chương" đếm ảnh còn dùng. Chương đang mở ở tab khác → 423; đã có page → 409.

Đổi thứ tự ảnh (cùng điều kiện `editable`, thứ tự này là thứ tự ghép/cắt trang): kéo-thả thumbnail (vạch xanh báo chỗ
thả), menu chuột phải "Đưa lên đầu / Lên 1 / Xuống 1 / Đưa xuống cuối", hoặc Alt+↑/↓ trên thumbnail đang focus (focus đi
theo ảnh). Cập nhật lạc quan, lỗi → trả thứ tự cũ + toast; toast "Đã đổi thứ tự" có "Hoàn tác". Ảnh đã xoá vẫn giữ chỗ.
`PUT …/chapters/:id/source-files/order {ids}`: `ids` phải đúng bộ source file của chương (thiếu / thừa / trùng → 400
`source_set_mismatch`), ghi `ord = vị trí`; cùng guard với PATCH skip (423 chương đang mở ở tab khác, 409 `chapter_not_draft`).
Ingest đọc theo `ord` nên worker không đổi. Kéo-thả HTML5 gốc không chạy trên màn cảm ứng — dùng menu.

**Sau khi cắt trang** "Ẩn trang n" ở menu chuột phải thumbnail (hoặc nút ⋯ khi là trang đang mở) ẩn trang
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
1s gộp 1 bước; kéo/đổi khung ghi khi thả. Mọi thao tác (kể cả áp kết quả AI, "Bỏ chỉnh sửa tay" ở menu trang, chèn
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
ngôn ngữ (`worker/tests/test_font_coverage.py`). Dropdown font của panel khối (`kit.idsFor(target_lang)`) và Font mặc
định ở cài đặt series (`useBundledFonts().ids(target_lang)`) chỉ liệt kê font hợp ngôn ngữ đích; font đang dùng mà
không hợp vẫn hiện, ghi `(thiếu chữ …)`. Không chặn ở API/worker — chỉ là gợi ý. Bộ font scanlation Việt hoá
(WildWords, Augie, Mighty Zeo, Felt… từ bộ TeddyBear/iCiel và MTO) thiếu chữ es/pt/fr nên chỉ hiện cho series vi/en/id;
một số file đã được sửa metric dọc lúc thêm vào (bảng `typo` Việt hoá hỏng → bỏ cờ `USE_TYPO_METRICS` hoặc sửa dấu
`sTypoDescender`), nên khi thay file phải kiểm lại khoảng cách dòng.

**Font của bạn** (Font của tôi, `/fonts`, upload TTF/OTF ≤ 10MB, ≤ 20 font): `loadFonts(fetchCustom)` ở
`fonts.ts` nạp thêm từng font bằng `FontFace(font_id, url(presigned))` (`font_id` = `custom-<8 hex>`), metric
(`units_per_em/ascent/descent`) lấy từ API — API đọc bằng fontkit theo đúng quy tắc `read_metrics` của worker (test parity
với manifest). Danh sách lấy tươi mỗi phiên chương (`staleTime: 0`) nên URL còn hạn; font nạp lỗi (URL hết hạn) → lấy lại danh sách
1 lần rồi nạp lại; không lấy được font tuỳ chỉnh thì editor vẫn chạy với font gói sẵn. Panel khối liệt kê thêm 2 nhóm "Font hệ thống" (admin upload, mọi người dùng thấy; `GET /api/fonts` trả `system: true`, `FontKit.custom` giữ cờ này) và "Font của bạn"; giới hạn 20 font chỉ đếm font riêng.
Box có font không biết (font tuỳ chỉnh đã xoá, state cũ): metric theo font thoại mặc định và `canvasFont` có family dự phòng là font đó
(`"<font_id>", "<mặc định>"`) nên đo và vẽ nhất quán, không lỗi; select hiện `<id> (thiếu)`. Font thoại mặc định của series dùng
được khi là font gói sẵn hoặc font tuỳ chỉnh đã nạp (`kit.knows`).

Cài đặt series (`?tab=settings`, `series-settings-form.tsx`) cũng gọi `loadFonts` để dropdown Font mặc định vẽ mỗi option bằng
chính font đó (`.font-select` bật `appearance: base-select` khi trình duyệt hỗ trợ). Dropdown có option "+ Tải font lên…"
cuối dropdown: chọn file → `uploadCheckedFont` (cùng kiểm tra đuôi / 10MB / 20 font với trang Font của tôi) → font mới được chọn
cho đúng ô, chỉ thành mặc định khi bấm Lưu.

Cờ "tràn khung" (bảng văn bản, cột thumbnail, panel khối, cảnh báo xuất) dùng chung `boxOverflow` trong `measure.ts`, có dung
sai `max(2px, 4% cạnh box theo trục tràn)`: box auto_fit do render.py chọn cỡ, đo lại ở trình duyệt lệch vài phần
nghìn px — không tính là cần xem. "Khối" ở bảng văn bản/đếm/cảnh báo chỉ là vùng chữ; region `bubble` (khung bóng
thoại) vẫn trong state nhưng không thành dòng (`text-table/rows.ts`).

## Ảnh và mask

- Ảnh page tải 1 lần (presigned GET ≤ 15') thành `ImageBitmap`, vẽ theo tile 2048px, chỉ tile trong vùng nhìn ± 1;
  Stage bằng khung nhìn. Layer sạch theo `pages.clean_rev`.
- Tẩy chữ (B tô, E tẩy nét; thanh phụ trên canvas có nút đổi "Tô" / "Tẩy nét") → PNG chỉ phủ vùng có nét (≤ 4096px/cạnh) → `POST /pages/:id/mask-upload` (presigned POST
  PNG ≤ 5MB, key `user-mask/{uuid}.png`) → `POST /pages/:id/reinpaint {user_mask_key, offset, base_clean_rev}`
  (cần khoá; rev cũ → 409) → poll `/jobs/:id` → tải lại page lấy `clean_rev` mới.
- OCR vùng (R): kéo khung → `POST /pages/:id/ocr-region {bbox}` → poll → chèn region + box (thao tác có undo).
  Checkbox "Xoá chữ gốc" ở thanh phụ Quét chữ (mặc định bật, nhớ ở localStorage `mtl.ocr.autoErase`): khối dịch chèn xong →
  khung vào hàng xoá của page (`editor/erase-queue.ts`) → `POST /pages/:id/reinpaint {auto_text_bbox, base_clean_rev}`,
  **tuần tự** giữa các khung (mỗi lần dựng trên `clean_rev` job trước trả; 409 `clean_rev_changed` → thử lại 1 lần với
  rev server báo) → tải lại page. Chỉ xoá khi đã có khối dịch: OCR lỗi / "Huỷ quét chữ" → chữ gốc giữ nguyên. Hàng xoá mỗi
  page sống tới khi rời chương (đổi trang không bỏ lần xoá của khối đã chèn). Worker chỉ xoá nét chữ CTD thấy trong khung
  (kể cả SFX), không xoá cả khung; không thấy chữ → job fail "Không thấy chữ trong khung…" (dùng Mask). Xoá ảnh sạch
  không hoàn tác được (như Tẩy chữ). "Dịch lại khối" không xoá. Lần xoá lỗi chỉ báo trong editor, không thành "trang lỗi"
  ở tiến độ chương (`routes/progress.ts` bỏ job thao tác editor đã kết thúc).
  "Dịch lại khối" (icon đầu panel khối) = cùng job trên bbox vùng OCR của khối, thay chữ gốc + bản dịch; khối tự
  thêm (không có vùng OCR) thì nút tắt.

## Kết quả AI mới

`ai_update_available` → panel diff theo vùng (bản hiện tại vs AI mới), áp từng vùng/tất cả (giữ vị trí, kiểu chữ
người đã chỉnh). "Đã xem" → `POST /pages/:id/ai-update/ack {ai_rev}` (chỉ tắt cờ nếu đúng rev đã xem).

## Rail, panel khối, thanh phụ công cụ và panel Văn bản

Rail công cụ (`tool-rail.tsx`, hành vi ở `tool-rail-model.ts`, 48px, chỉ icon): **Chọn (V)** mở / thu panel khối (bấm lại icon
đang mở → thu, công cụ giữ nguyên; chỉ mở khi có khối đang chọn hoặc có nội dung phải xử lý — không có gì thì không mở, như phím V); **Chữ (T)** / **Tẩy chữ (B)** / **Quét chữ (R)** chỉ đặt công cụ — tuỳ chọn nằm ở thanh phụ
nổi trên canvas, không có panel riêng (panel khối thu lại trừ khi còn nội dung phải xử lý); **Văn bản** chỉ mở/thu panel Văn
bản, không đổi công cụ. Mỗi nút có `aria-label` "Tên (phím)", `aria-pressed`, và tooltip (tên + phím) hiện khi rê chuột
**hoặc focus bàn phím** (CSS `:hover` / `:focus-visible`, `.cw-tip`); nút tắt có lý do trong tooltip và `aria-describedby`.
Phím V/T/B/E/R đổi công cụ (đổi khỏi Chọn → panel khối thu nếu hết nội dung; về Chọn khi còn khối đang chọn → panel khối mở lại). `PanelId` chỉ còn `tool` | `doc`; tab của
panel Văn bản là `DocTab` (`table` | `find` | `glossary` | `proofread`).

**Panel khối** (272px, `role="complementary"` "Chọn & sửa") đóng mặc định, **đè lên mép trái canvas** (cùng ô lưới với canvas
nên canvas không đổi bề ngang khi đóng/mở; cụm pager căn giữa phần canvas còn lộ nên không bị panel che). Tự mở khi: chọn khối ở công cụ Chọn — kể cả bấm lại đúng khối đang chọn (`editorStore.reselects`) — (chọn bằng
chuột thì mở sau khi nhả chuột để không chắn con trỏ giữa chừng kéo; đang ở panel Văn bản thì giữ); có nội dung phải xử lý
mà không chọn khối — AI có bản mới của trang đang mở, hoặc xung đột khi lưu (`hasToolContent`). Tự đóng khi bỏ chọn khối
(bấm nền, Esc, đổi trang) và hết nội dung; còn xung đột / AI mới thì không tự đóng. Thu Văn bản (nút rail hoặc "Thu panel") khi còn nội dung phải xử lý → về panel khối thay vì đóng hẳn. Thu panel khối bằng tay
khi còn xung đột / AI mới → băng cảnh báo ("N thay đổi chưa áp được", "AI có bản mới cho trang này") + nút "Xem"; băng AI
cũng hiện khi đang ở panel Văn bản. Không nhớ panel nào theo trình duyệt (khoá cũ `mtl.layout` bị xoá khi vào màn chương,
`layout-prefs.ts`). Chỉ xem → mọi công cụ trừ Chọn tắt (cả phím T/B/E/R), panel hiện nội dung nhưng ô nhập và 3 icon bị tắt;
chương chưa có page → Chữ / Tẩy chữ / Quét chữ tắt; chương chưa dịch xong → các tab Tìm / Thay, Glossary, Hiệu đính tắt (đang ở tab đó thì về Bản dịch).

Khối bị panel che thì canvas tự cuộn lộ ra: `page-layout.revealBlockView` (thuần, đo theo `chapterStore.box` và bề ngang panel thật
`chapterStore.cover`, không số cứng; chỉ dịch khi khối bị che / ngoài khung, chừa 24px, qua `clampView` nên không quá đầu/cuối
trang; chia đôi gốc / dịch dùng `contentBox` + `x0`). `clampView(…, coverLeft)` nới tầm cuộn ngang thêm đúng bề ngang panel
nên lăn chuột và lần đổi cỡ khung sau đó không kẹp khối về lại dưới panel. Khung canvas đổi bề ngang lúc panel khối đang mở
(chuyển từ panel Văn bản rộng sang panel khối: cột thu lại, canvas rộng ra) → đo lại và cuộn lộ khối đang chọn (`chapterStore.revealSelection`, gọi lại sau mỗi lần canvas căn lại trang theo khung: đổi cỡ khung, chia đôi, nút %). Panel thu → khung nhìn được kẹp lại ngay. Bấm một
dòng bảng văn bản đi qua cùng `pick` (chọn khối + `revealRect`); panel Văn bản không che canvas nên không cần cuộn thêm.

- **Đầu panel**: "Khối i/N" + 3 icon Dịch lại khối · Nhân đôi khối (`actions.duplicateBox`: id mới, lệch +16px, cùng
  chữ/kiểu, `region_id = null` → dòng "Tự thêm", 1 bước undo) · Xoá khối (như phím Delete) + "Thu panel". Enter / double-click
  vẫn sửa chữ trực tiếp trên ảnh.
- **Thân** (`select-panel.tsx`): "AI có bản mới" (khi có) và xung đột khi lưu luôn ở đầu thân (xung đột hiện trên mọi panel);
  có khối — Gốc (OCR), Dịch (`#cw-translation`, cùng nguồn với bảng), cảnh báo ngắn "Tràn 12px" (cách xử lý ở tooltip), Font + Cỡ,
  nhóm "Kiểu chữ" thu gọn: Loại chữ (xem dưới), Tự khớp cỡ chữ vào khung, giãn dòng, lề, căn lề, căn dọc (Trên / Giữa — khối mới mặc
  định Giữa, khối lưu từ trước giữ Trên; "Áp kiểu" chép cả căn dọc), màu, viền, ẩn khi xuất, "Áp kiểu cho khối <loại>" — mọi trang, kể cả trang
  đang mở, ghi trong 1 lượt `PUT /chapters/:id/states` chung `batch_id`; toast "Hoàn tác" khôi phục cả lượt qua
  `find-replace/undo` (`conflicts: "skip"`: trang đã sửa tiếp được giữ và nêu trong toast), lượt là 1 bước trong lịch sử undo của trang đang mở (mốc không có patch): Cmd+Z / nút Hoàn tác ở bước đó gọi đúng hoàn tác của toast, rồi Cmd+Z tiếp lùi các sửa trước lượt; mốc thuộc trang đang mở lúc áp (đổi trang thì Cmd+Z ở trang khác không thấy), không làm lại (redo) được lượt. Cùng cơ chế cho Tìm/Thay và Áp glossary (`apply` trả `versions` = version mới từng page; Cmd+Z hoàn tác với `conflicts: "skip"`, nút Hoàn tác của panel tự tắt; Cmd+Z trong ô nhập vẫn là undo của ô); chương đang xử lý → 409 `chapter_busy`). Chưa chọn khối và không có nội dung: một dòng gợi ý.
  **Loại chữ** (`TextStyleSelect` ở `panels/Properties.tsx`): chỉ hiện khi khối có vùng (`region_id`) **và** series đã chọn ≥ 1 slot
  Suy nghĩ / Ghi chú (khối vẽ tay không vùng → không có ô). Option: Thường + loại có slot (+ loại hiện tại của vùng nếu slot đã bị
  bỏ, để không mất giá trị). Đổi = `setTextStyle`: đặt `region.style` và `font_family` của khối theo `fontForStyle` (slot của
  loại; trống → font theo kind như worker), **1 bước undo**. Chương dịch trước 0.8.0 không có `style` (= Thường); đổi tay bằng ô này.
- **Thao tác trang** là một menu (`page-rail.tsx`): nút ⋯ luôn hiện trên thumbnail trang đang mở, chuột phải / Shift+F10 / phím Menu mở cùng menu. Trang đang mở: Dịch trang n / Dịch lại trang n (trang chọn được, không bận), Bỏ chỉnh sửa tay trang n (chỉ khi khác bản AI; không hỏi lại, hoàn tác bằng toast hoặc Cmd+Z; nút Hoàn tác của toast chỉ lùi đúng bước này, một lần, trên đúng trang đó), Ẩn trang n. Trang khác: chuột phải chỉ có Ẩn trang (trang ẩn: Khôi phục). Trạng thái + cờ của trang ở thumbnail (viền, cờ "!" / "×", tooltip, tên truy cập); chi tiết kỹ thuật của trang lỗi (lỗi thô của
  provider) đọc ở Hoạt động › "Chi tiết kỹ thuật".
- **Thanh phụ trên canvas** (`tool-panels.tsx` `CanvasToolBar`, `role="toolbar"`, nổi giữa mép trên, không đẩy bố cục):
  **Chữ** "Thêm chữ · Kéo khung trên ảnh" (kéo xong → khối mới được chọn, công cụ về Chọn, panel mở, sửa chữ ngay trên ảnh);
  **Quét chữ** "Kéo khung quanh chữ" + checkbox "Xoá chữ gốc" (đang quét: "Đang quét n vùng…" + Huỷ); **Tẩy chữ**
  (`panels/MaskToolBar.tsx`; rail không có nút Tẩy riêng — E / nút "Tẩy nét" là chế độ của Tẩy chữ): Tô ↔ Tẩy nét, cỡ bút,
  Bỏ nét, "Xoá chữ vùng tô".
- **Panel Văn bản** (560px, `role="complementary"` "Văn bản", chiếm cột — không đè canvas; đóng mặc định, không nhớ qua
  tải lại) với dải 4 tab `role="tablist"` (`doc-tabs.tsx`; ←/→/Home/End chuyển tab). Mỗi tab mount lần đầu khi được mở, sau đó chỉ
  ẩn (`hidden`) — không mất nội dung đã mount: bảng và vị trí cuộn, kết quả xem trước Tìm/Thay (Hoàn tác vẫn chạy), hộp
  xác nhận hiệu đính.
  - **Bản dịch**: bảng văn bản cả chương (xem dưới), lọc "Chỉ khối cần xem" / "Chỉ trang đang mở".
  - **Tìm / Thay** và **Glossary** (Áp glossary): xem [export-and-batch-edit.md](./export-and-batch-edit.md).
  - **Hiệu đính · N**: xem mục [AI hiệu đính](#ai-hiệu-đính). N = số gợi ý chờ duyệt của cả chương (`usePendingProofread`,
    cùng cache `proofreadKey` với panel, tính theo bản dịch hiện tại của khối), ẩn khi 0.

**Bảng văn bản** (`text-table/`): 1 dòng / khối, 4 cột — Vị trí "trang·khối" (`3·5`), Gốc, Dịch sửa tại chỗ, cờ ("!" cần
xem: tràn khung / trống / cần soát; "↻" chỉ còn AI có bản mới; có `role="img"`, tên truy cập và tooltip là lý do, không chỉ
màu; dòng ổn không có cờ). Loại khối (Thoại / Chữ nền / SFX / Tự thêm) không còn cột: ở panel khối ("Kiểu chữ › Loại chữ") và
trong `title` của dòng. Ảo hoá; bấm dòng → mở trang + chọn khối trên ảnh; Enter / Shift+Enter dòng sau / trước (xuyên trang), Alt+Enter xuống
dòng trong ô, Esc bỏ focus; đồng bộ 2 chiều với canvas và panel khối.

## AI hiệu đính

Tab "Hiệu đính" của panel Văn bản (`proofread-panel.tsx`, trạng thái thuần ở `proofread-model.ts`): "Chạy AI hiệu đính" /
"Hiệu đính lại cả chương" (lưu hết trước, `POST …/proofread`; tắt khi chương chưa dịch xong hoặc đang chạy; poll 2,5s
khi job chạy). Bấm chạy → hộp xác nhận **một dòng ước tính** "N trang · $a – $b · khoảng x–y phút" (giá cao nhất khi chưa
gán model; model + cơ sở ước tính trong `title`) + nút "Chạy hiệu đính" + ⓘ (`PROOFREAD_DATA_NOTICE`: ảnh trang, chữ gốc,
bản dịch, glossary, quy tắc xưng hô gửi nhà cung cấp AI) + Huỷ; không còn đoạn giải thích. → danh sách gợi ý theo trang rồi thứ tự khối: "Trang n · Khối i" (bấm = mở trang + chọn khối), bản AI
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

Canvas hiện **từng trang một** (page active); đổi trang ở cột thumbnail, cụm "‹ n/M › · 62%" giữa đáy canvas
hoặc ←/→/A/D — thumbnail (`aria-current`) và `?page=` luôn theo page active (URL không có `?page=` = trang
đầu).

Thanh trên màn chương: nút bật/tắt **Gốc** (tên truy cập "Xem gốc"; `aria-pressed` = đang hiện ảnh gốc, kể cả lúc giữ `O`; bấm: Gốc ↔ Dịch,
đang Chia đôi → Gốc) và mục **"Chia đôi gốc / dịch"** trong menu "⋯" (`menuitemcheckbox`; tắt = về Dịch)
(`chapterStore.viewMode`). Gốc = ảnh gốc, ẩn chữ; Dịch = ảnh sạch + chữ (mặc định); Chia đôi = cột Gốc bên trái cột
Dịch trên cùng 1 Stage (cuộn/zoom đồng bộ), chỉ cột Dịch nhận thao tác — bấm/kéo ở cột Gốc = kéo canvas. Giữ `O` =
tạm xem Gốc, nhả = về chế độ trước (chia đôi: cột phải cũng hiện gốc, bố cục giữ nguyên). `editorStore.showOriginal`
suy ra từ chế độ đang hiện.

Khung nhìn mở chương / đổi trang / bật-tắt Chia đôi: `page-layout.pageStartView` + `fitScale` theo **chính page đang
hiện** (không theo page rộng nhất chương) — vừa bề ngang nội dung, trọn chiều cao page dạng tờ (cao ≤ 2× rộng; dải
webtoon chỉ vừa bề ngang), trần 100%, căn giữa ngang, đầu page sát mép trên. Khung đổi cỡ (thu/mở panel) trước khi
người dùng động vào khung nhìn → vừa lại; đã tự zoom (Ctrl/Cmd+cuộn, `chapterStore.zoomed`) → đổi trang / Chia đôi giữ
zoom. Nút % trong cụm giữa đáy canvas (`canvas-controls.tsx`) đổi **Vừa khung** (khung nhìn mở trang, bỏ cờ zoom) ↔ **100%** (mức 1, đầu trang sát mép
trên, giữ khi đổi trang) qua `chapterStore.fitView`; đang zoom khác → 100%. Tên + tooltip nói trạng thái và việc bấm sẽ làm; cụm căn giữa phần canvas còn lộ khi panel khối đè. Page đang chạy AI (`pageLevel`
busy): cột Dịch hiện ảnh gốc + lớp mờ + "Đang xử lý…", không vẽ chữ; ảnh sạch vẫn tải ngầm để đổi ngay khi xong.
Page đã xoá chữ + OCR, chờ dịch (`prepared`, "Chờ dịch"): hiện ảnh sạch như thường để soát, sửa mask trước khi bấm Dịch.
Chế độ Gốc không đổi.

Cuộn quá mép: đang ở mép dưới (hoặc trên) của page mà vẫn cuộn tiếp ≥ 160px (cộng dồn, 2 nấc chuột hoặc 1 cú vuốt
trackpad) → sang trang sau (trước), cùng đường `session.activate` như pager (lưu page cũ trước); page nằm trọn khung
(kể cả vừa khung với lề `FIT_EDGE` = 16px của "Vừa khung"; khung nhìn đứng yên, wheel không xê dịch) = ở cả hai mép. Cuộn xuống vào đầu trang mới, cuộn lên vào cuối trang mới; trượt + mờ dần ~200ms, tắt khi
`prefers-reduced-motion`. Sau mỗi lần đổi khoá ≥ 600ms và tới khi quán tính dứt (ngắt ≥ 300ms), tối đa 1,5s kể từ lần đổi; Ctrl/Cmd/Shift+cuộn,
cuộn ngang, đang sửa chữ, đang giữ nút chuột (kéo box/canvas), trang đầu/cuối không đổi trang. Trong lúc khoá, wheel cùng hướng bị nuốt (không cuộn page mới) nên trang mới luôn vào đúng đầu/cuối; wheel ngược hướng vẫn cuộn page bình thường (chưa đổi trang). Hết trần 1,5s mà wheel vẫn đến liên tục thì thôi nuốt nhưng vẫn chưa cho đổi trang cho tới khi ngắt ≥ 300ms (cú vuốt dài trên page nằm trọn khung không lật thêm trang thứ hai); page cao hơn khung đã cuộn rời mép thì cuộn đều tới cuối page lại lật tiếp, không cần ngắt. Logic thuần ở `wheel-page-flip.ts`.

## Phím tắt

Bảng duy nhất ở `apps/web/src/features/editor/shortcuts.ts` (thuần, có test), 1 listener `use-shortcuts.ts` chỉ gắn
khi màn chương mount; bảng tra trong UI: phím `?` hoặc "Phím tắt (?)" trong menu "⋯" thanh trên. Phím đơn tắt khi focus trong ô nhập; drawer đang
mở → tắt phím màn chương (Esc đóng drawer; menu Xuất cũng đóng bằng Esc).

| Phím | Hành động |
|---|---|
| V · T · B · E · R | Chọn · khung chữ mới · mask · tẩy mask · OCR vùng (OCR đổi từ `O` sang `R`) |
| giữ O · `\` | Tạm xem gốc · đổi Gốc ↔ Dịch (như nút Gốc) |
| A / D · PageUp / PageDown · ← / → | Trang trước / sau (cuộn tới + thành trang đang sửa) |
| Alt+↑ / Alt+↓ | Khối trước / sau theo bảng văn bản (xuyên trang) |
| Ctrl/Cmd+Z · Ctrl/Cmd+Shift+Z · Ctrl+Y | Hoàn tác · làm lại (trang đang sửa; trong ô nhập là hoàn tác của ô) |
| Ctrl/Cmd+S (cả trong ô) | Lưu ngay, chặn hộp lưu của trình duyệt |
| Ctrl/Cmd+F (cả trong ô) | Mở panel Văn bản ở tab "Tìm / Thay" (kể cả khi đang ở công cụ khác), focus ô tìm (khi chương đã dịch xong) |
| Enter · Delete · Esc | Sửa chữ box đang chọn trên ảnh (double-click cũng được; Ctrl/Cmd+Enter lưu, Esc huỷ) · xoá box · bỏ chọn |
| ? | Bảng phím tắt |
| Space giữ + kéo (hoặc chuột giữa) | Kéo canvas; cuộn = cuộn strip, Ctrl/Cmd+cuộn = zoom |

## Menu Xuất / Drawer Hoạt động

**Xuất** là menu ngay dưới nút Xuất (xem dưới); **Hoạt động** và Phím tắt là drawer phải 420px (`apps/web/src/app/drawer.tsx`):
scrim xám, Esc/scrim/Đóng = đóng, focus vào drawer khi mở, trả về nút đã mở khi đóng.

- **Xuất chương** (`features/chapter/export-menu.tsx` + `export-panel.tsx`): phạm vi cả chương. Popover `role="dialog"`
  "Xuất chương" không chặn thao tác (không có lớp phủ), căn mép phải theo nút đã mở (nút Xuất; hoặc nút ⋯ khi "Xuất" nằm
  trong menu ⋯ vì chương có trang lỗi — cùng nội dung), cao tối đa tới đáy cửa sổ và cuộn trong menu. Đóng bằng Esc / bấm ra ngoài
  (bấm lại nút mở = đóng) / Tab ra khỏi menu, trả focus về nút. Từ trên xuống: 1 dòng
  "N chỗ cần xem" (`<details>`: mở ra là các câu hậu quả trong file, xem [export-and-batch-edit.md](./export-and-batch-edit.md#menu-xuất-chương),
  + "Xem N chỗ này" mở tab Bản dịch lọc "Chỉ khối cần xem") → nút **"Tải chương (.zip|.cbz)"** (tiến độ ngay tại nút, xong
  tự tải; "Tạm dừng — hết ngân sách" khi hết ngân sách AI, tự xuất tiếp; link "Tải xuống" tại chỗ phòng trình duyệt chặn; link
  hết hạn → nói rõ, bấm tải để xuất lượt mới) → "Tuỳ chọn" (thu gọn, 1 dòng tóm tắt: định dạng, cách chia ảnh, chất lượng, có
  đưa trang chưa dịch) → "Lần trước · 2 giờ trước · … + **Tải lại**" (khi rảnh). Đóng menu giữa chừng không mất việc: mở lại
  thì thấy đúng tiến độ lượt còn chạy (nhận từ danh sách lượt xuất); tiến độ cũng ở chip thanh trên ("· đang xuất") và Hoạt
  động; xong lúc menu đóng → thông báo "Đã xuất xong." + "Tải xuống". Cảnh báo tính từ dữ liệu đã có (`export-warnings.ts`,
  không gọi API). Vẫn xuất được khi có cảnh báo. `?drawer=export` (nút "Xuất lại" ở home / danh sách chương) mở chương với
  menu Xuất mở sẵn (căn mép phải thanh trên).
- **Hoạt động** (`features/chapter/activity-drawer.tsx`): mở từ chip thanh trên (khi chương đang chạy hoặc không có trang cần
  xem) hoặc mục "Hoạt động" (kèm số việc đang chạy) trong menu ⋯; nút ở app shell chỉ hiện khi có chương đang tải ảnh. Upload của tab (mọi chương, thử lại file lỗi); ở màn chương thêm job của chương (trang đang xử lý/lỗi theo
  `error_class`, "Chạy lại trang lỗi", trang chờ AI tự thử lại) và lượt xuất gần đây (tải lại, huỷ).
- **Lỗi job của trang** (`features/chapter/job-error.ts`): lỗi `provider` / `rate_limited` không làm job hỏng ngay —
  queue requeue có backoff (≤ 20 lần, `apps/api/src/jobs/errors.ts`), trang vẫn "Đang xử lý". Màn chương đọc
  `error_class` + `run_after` của job trong `/progress` → băng cảnh báo + thumbnail (viền cam "Chờ AI", title có câu lỗi)
  ("tự thử lại lúc HH:MM (lần n)"). Job hỏng/huỷ → câu lỗi + "Dịch lại trang" (menu thumbnail) / "Chạy lại trang lỗi"; lỗi thô trong
  Hoạt động › "Chi tiết kỹ thuật".

## Chưa đo

Hiệu năng page 800×12.000 / 20.000px (mở < 2s, cuộn ≥ 50fps M1), Safari 18, reinpaint ≤ 15s với worker Mac thật.
