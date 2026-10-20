# Báo cáo tham chiếu UX: tool dịch manga/manhwa (2026-10-20)

Mục tiêu: lấy pattern UI/UX + workflow để thiết kế lại web app scanlation KO→VI (hiện tại: 7 bước điều hướng, upload riêng, editor route-per-page, bị chê "khó dùng").
Mức tin cậy: README/docs chính thức = cao; trang marketing/directory = thấp (ghi rõ). Mục "Hạn chế" cuối báo cáo.

---

## 0. Kết luận 5 dòng

1. Không tool nào đáng học có "trang upload riêng". Tất cả: tạo/mở project -> import (menu hoặc thả) -> vào thẳng editor có page rail. Saber-Translator (web, giống app mình nhất) tách "Translate page" và "Edit page" -> chính là kiểu UX bị chê; đừng bắt chước.
2. Editor chuẩn cộng đồng = 3 cột: page rail trái | canvas giữa | inspector phải (thuộc tính + danh sách text block/layer). Koharu, comic-translate, BallonsTranslator, manga-translator-ui, ImageTrans đều đi hướng này.
3. Chạy AI = một thanh "scope (trang hiện tại / trang chọn / cả chương) x stage (detect, OCR, dịch, inpaint) + nút Run" đặt ngay trên canvas (Koharu). Rerun phải bảo toàn chỉnh sửa tay.
4. Điểm mà tool mã nguồn mở đều yếu: danh sách text song song nguồn-dịch toàn chương để proofread, strip dài. Torii/BallonsTranslator/ImageTrans có find-replace toàn chương/glossary. App mình nên làm tốt 2 điểm này để khác biệt.
5. Đề xuất: bỏ 3 màn trung gian, còn 3 màn: Dự án (series) -> Chương = editor gộp (có tab Upload/Dịch/Sửa/Xuất trong cùng một màn) -> Export (drawer, không phải trang).

---

## 1. Bảng so sánh

| Tool | Loại / license / mức sống | Layout chính | Workflow | Điểm mạnh UX đáng học | Điểm yếu |
|---|---|---|---|---|---|
| **Koharu** (koharu-rs) | Desktop Rust, Apache-2.0, ~6.4k sao, commit 2026-10-19 | Start screen (thư viện project) -> editor: Page rail trái (212 trang, filter, thumbnail + "12 layers") / canvas giữa với toolbar dọc nổi (select, text, brush, eraser, picker, remove) / inspector phải (tab Properties + Agent; font, align, border + danh sách Layers có mắt ẩn/hiện, opacity) | Tạo project -> Import Pages (file/folder/ZIP/PDF) -> chọn scope+stage -> Run -> review trong inspector -> Export PNG/PSD | Processing selector trên canvas (scope x stage), activity center, rerun bảo toàn edit, "Remove" brush = inpaint tức thì, page rail kéo thả sắp xếp, layer text hiển thị `loại: Dialogue / Free Text` | Không có bảng nguồn-dịch toàn trang ngoài layer list; không có bulk edit; issue: không re-detect được vùng đã xoá (#995), pipeline "quá cứng" cần workflow preset (#592), webtoon "cần điều tra" (#1163), glossary mới ở dạng đề xuất (#339) |
| **BallonsTranslator** | Desktop PyQt, GPL-3.0, ~5.2k sao, commit 2026-10-18 | Thanh icon trái (mở folder, list, chế độ), canvas giữa, panel font/text bên phải, status bar dưới có translator/ngôn ngữ/inpaint tool + nút Run; 3 chế độ: xem, vẽ (mask/brush), sửa text | Mở folder -> cấu hình ngôn ngữ -> Run -> sửa từng trang (A/D qua trang, tự lưu) | Phím tắt cực dày; tìm/thay toàn dự án (Ctrl+G); nhập/xuất Word; style preset; glossary file + lịch sử dịch + "memory" LLM theo dự án; trong suốt layer 0-9 để so sánh gốc/dịch; "thích ứng ảnh tỉ lệ cực (webtoon)" | UI lỗi thời (Qt kiểu cũ), undo bị xoá khi sang trang, rất nhiều issue là lỗi cấu hình translator; không có khái niệm chương/series |
| **comic-translate** (ogkalu2) | Desktop PySide, Apache-2.0, ~3k sao | Cột icon trái (open/save/export/home/settings) + thanh nút stage trên cùng (Detect, OCR, Get Translations, Segment, Clean, Render) / list file nhỏ / canvas / panel phải: 2 ô text Source-Target cạnh nhau + font/outline + "Set for all" + công cụ vẽ box/inpaint | Mở ảnh -> Automatic (một nút Translate) hoặc Manual (bấm từng stage) -> sửa -> export | Chuyển Automatic/Manual rõ ràng; từng stage là một nút (tự sửa khi một stage hỏng); đọc ảnh xong trong lúc ảnh khác còn đang dịch; **Webtoon mode** (v2.8.8: "stream virtual page results") | Webtoon mode hay lỗi (patch inpaint biến mất khi cuộn #470, #429); trang dài lỗi OCR (#475); chỉ 1 block text trong panel -> không list toàn trang; thiếu nút "Original" (#326) |
| **manga-translator-ui** (hgmzhn, fork của manga-image-translator) | Desktop + có Web UI/Docker, GPL-3.0, ~3k sao | Editor: file list + region list + canvas + panel thuộc tính; tab Mask/Brush/Stamp; rich-text nổi | Batch cả folder, xuất PSD, JSON/TXT in/out | **Batch Manage**: lọc vùng theo điều kiện, sửa thuộc tính/thay chữ hàng loạt, **xem trước các vùng khớp trước khi áp**, backup/restore; so sánh 2 cột với bản gốc; auto trích glossary; phím tắt: A/D, V (dọc/ngang), Q/W/E tool, Ctrl+wheel chỉnh cỡ chữ | Quá nhiều tính năng, UI dày đặc, doc tiếng Trung; Web UI chủ yếu quản lý tài khoản/quota |
| **manga-image-translator** (zyddnys) + web | Python engine, GPL-3.0, ~10.5k sao; demo cotrans.touhou.ai **đã ngừng** | Web mode: server cổng 8000, "Old UI"/"New UI" (README chỉ link doc) | Upload -> task id -> poll -> tải kết quả | Mô hình API đồng bộ/bất đồng bộ + task id; làm engine tốt | Không phải editor; web UI là demo upload-một-chiều, không sửa được. Không dùng làm tham chiếu UX |
| **Saber-Translator** | Web (Flask+front) + extension, GPL-3.0, ~3.7k sao, commit 2026-10-13 | **Bookshelf** (thẻ sách, tag, search) -> Book -> Chapter -> **Translate page** 3 panel (trái: settings + nút hành động xếp dọc; giữa: xem gốc/dịch; phải: thumbnail) -> **Edit mode** là chế độ khác (2 ảnh cạnh nhau + panel bubble phải) -> Task Center | Import vào backend ngay (sách/chương), task chạy nền kể cả đóng tab | Task Center (pause/resume/retry, sống sót khi đóng tab); đối chiếu gốc/dịch trái-phải hoặc trên-dưới, đồng bộ zoom; "Áp dụng và sang ảnh tiếp" Ctrl+Enter; glossary + non-translate list theo sách; import/export JSON/LabelPlus | **Hai chế độ tách biệt (Translate vs Edit) + cột nút màu xếp dọc dài** (hình thật: ~10 nút màu); không có danh sách bubble ("không có danh sách bubble riêng"); đây là phản mẫu cho "không hình dung được workflow" |
| **ImageTrans** (xulihang) | Desktop Java, thương mại/nguồn doc mở | Toolbar trái nhiều nhóm (OCR, chọn nhiều, cắt, tạo nhanh, font, sắp xếp, workflow, edit) / canvas / **danh sách text area** / tab phải: translation assistant (translation memory, MT, terminology) | New project -> import -> transcription (vẽ box/OCR/detect balloon) -> dịch (theo CAT) -> generate; Project > Batch | Tư duy CAT: translation memory + terminology + XLIFF/docx round-trip; nút "Check Translated" ở góc dưới; style global < auto-size < local; Batch với custom workflow | UI nặng, đường học dốc; không hướng web |
| **TypeR** (Photoshop ext) | Extension PS, nguồn mở | Panel trong Photoshop: danh sách dòng script + style folder | Import script -> bấm dòng để chèn vào bubble đang chọn, tự căn giữa theo hình bubble | Mô hình "danh sách thoại bên trái, click là đặt vào ô"; style preset theo tag/thư mục, export/import thư mục style cho team; phím tắt tuỳ biến | Phụ thuộc Photoshop; không AI detect; chỉ đáng học mô hình typesetter (xem mục 2.6). Chi tiết README chỉ khẳng định: auto-center, style folders, phát hiện trang khi import |
| **Torii** (toriitranslate.com) | Web app + extension, trả theo credit (chưa rõ giá, nguồn marketing) | Web: upload ảnh/ZIP/PDF, bulk translate, editor box | Upload -> bulk -> sửa -> tải ZIP/PDF/PSD | **Global editing = find&replace toàn chương**, manual OCR bằng cách tô brush lên vùng sót, context chia sẻ giữa trang, layer ảnh tự chèn, undo | Doc không mô tả layout editor; Chrome extension 20K+ users (v2.0.16.4, 2026-04-25) |
| **Ichigo Reader** | Extension + web + iOS, thương mại | Panel dịch kèm trình duyệt/PDF/ZIP | Dịch để **đọc**, không phải scanlation | Thử không cần đăng ký | Review người dùng: chữ dịch quá lớn đè bubble bên cạnh, 4.1/5 (329 đánh giá), "upload cool off" giới hạn. Không phải tool cho nhóm dịch |
| **MangaTL / mangatranslator.ai, TranslateManga, Transmonkey** | Web thương mại | Directory listing nói: batch nhiều trang, lịch sử 24h, ảnh dài tới 10.000px (Transmonkey) | | | Chỉ có trang giới thiệu/directory, **không xác minh được UX editor** -> không dùng làm căn cứ |
| **Google Lens / Yandex** | Overlay miễn phí | Không có editor | | Tức thì | Không chỉnh được font/vị trí (nguồn đối thủ, thiên vị); không liên quan scanlation |

Nguồn: xem mục 4 (đánh số trong ngoặc ở cuối mỗi nhóm).

---

## 2. Pattern UX lặp lại (đã được cộng đồng chấp nhận)

Xếp theo độ phổ biến x tác động. "N/6" = số tool trong 6 tool có editor (Koharu, BT, CT, MTU, Saber, ImageTrans) có pattern.

### 2.1 Editor 3 cột: page rail / canvas / inspector — 6/6
- Rail trái có thumbnail + trạng thái (Koharu hiện "12 layers", kích thước) [K1][K-shot]; inspector phải có thuộc tính font/align + list layer [K-shot]. Mọi tool khác tương tự [CT-shot][S2][IT1].
- Áp dụng: giữ nguyên, thêm trạng thái mỗi trang (chưa xử lý / AI xong / đã duyệt / lỗi).

### 2.2 Thanh Run theo scope x stage, trên canvas — Koharu, CT, BT
- Koharu: Current page / Selected pages / Entire project + tick bất kỳ tổ hợp Detection/OCR/Translation/Inpainting; activity center; mỗi stage commit riêng nên lỗi giữa chừng không mất việc [K2].
- CT: mỗi stage là một nút riêng + chuyển Automatic/Manual [CT1][CT-shot]. BT: Run kèm bật/tắt từng module ở menu [BT1].
- Nhu cầu thật: Koharu issue #592 người dùng đòi workflow preset vì "Run All quá cứng" [K-i592].
- Áp dụng: mặc định 1 nút "Dịch chương" (full pipeline), dropdown "Nâng cao" mở scope x stage.

### 2.3 Rerun không phá edit tay — Koharu
- Detect bỏ qua trang đã có vùng; OCR/dịch ghi đè text sinh tự động nhưng giữ text đã sửa; inpaint bỏ qua trang đã có cleanup layer [K2].
- Phản mẫu: không re-detect được vùng đã xoá nhầm (#995) [K-i995]. Cần nút "Detect lại vùng này/trang này" tường minh.

### 2.4 Bản gốc vs dịch
| Cách | Tool | Ghi chú |
|---|---|---|
| Slider/phím trong suốt lớp dịch (0-9) | BT [BT1] | nhanh, không tốn không gian |
| Toggle "Show original" | Saber [S-shot], CT (đang xin #326) [CT-i326], ImageTrans "Check Translated" [IT1] | rẻ nhất, người dùng đòi |
| Hai cột đối chiếu, đồng bộ zoom/scroll, ngang/dọc | Saber edit [S-edit], MTU [MTU1] | cần cho QC/proofread |
| Layer gốc ẩn/hiện trong layer list | Koharu [K-shot][K3] | thuận cho PSD |
- Áp dụng: giữ phím `O` (giữ để xem gốc) + toggle split view. Không cần slider.

### 2.5 Danh sách text block / bảng nguồn–dịch
- CT: panel phải có 2 ô Source | Target cho block đang chọn [CT-shot].
- Koharu: source và translation sửa trong dòng layer mở rộng; "không có danh sách cặp nguồn-dịch" [K3].
- Saber edit: chỉ panel cho bubble hiện tại, điều hướng bằng nút next/prev bubble, **không có danh sách** [S-edit].
- BT: Alt+Arrow/WASD chuyển giữa các block; tìm/thay toàn dự án [BT1].
- ImageTrans: có text-area list + translation assistant [IT1].
- => Khoảng trống thị trường: không tool OSS nào có bảng "tất cả dòng của cả chương: # | trang | gốc | dịch | trạng thái" sửa tại chỗ như CAT tool. Đây là chỗ app web mình thắng được (tham chiếu ý tưởng: TypeR list dòng, ImageTrans CAT).

### 2.6 Mô hình typesetter "chọn dòng -> đặt vào bubble" — TypeR, ImageTrans
- TypeR: auto-center theo hình bubble, style theo thư mục/tag, chia sẻ thư mục style cho team [TR1]. Cho thấy typesetter cần **style preset gắn với loại thoại** (thoại, suy nghĩ, SFX, narration). Koharu cũng gắn nhãn layer (Dialogue, Free Text) [K-shot].
- Áp dụng: style preset theo series (đã có cài đặt font series) + gắn nhãn loại text.

### 2.7 Sửa hàng loạt
- Torii: find&replace toàn chương [T1]. BT: tìm/thay toàn bộ/nguồn/dịch, Ctrl+G; Word in/out [BT1]. MTU: Batch Manage có **preview vùng khớp trước khi áp** + backup/restore [MTU1]. CT: "Set for all" [CT-shot]. Saber: "đồng bộ style cho cả trang" (chỉ trong trang) [S-edit].
- Áp dụng: find&replace toàn chương + áp style cho nhiều block + preview trước khi áp.

### 2.8 Công cụ cleanup trên canvas
- Koharu: Remove brush = tô là inpaint ngay, không giữ mask [K4]. BT: rectangle tool (chuột trái xoá, phải khôi phục), brush [BT1]. Saber: R giữ để brush sửa, U giữ để khôi phục [S-edit]. Torii: tô để OCR lại vùng sót [T1].
- Áp dụng (app đã có brush mask): thêm "tô để re-OCR/re-clean" và phím giữ-tạm (R/U) đổi công cụ.

### 2.9 Task/queue chạy nền
- Saber Task Center: pause/resume/cancel/retry; đóng tab không dừng [S-task]. Koharu: activity center, 1 job/lúc, stop an toàn [K2].
- Áp dụng: thanh trạng thái nhỏ + dropdown; web app BẮT BUỘC chạy nền ở server.

### 2.10 Export
- Koharu: scope = trang chọn trong rail, hoặc trang hiện tại; PNG phẳng / PSD phân lớp; tên `0001_page.png`; ghi đè file cùng tên [K5].
- Torii: ZIP/PDF/PSD cả chương [T1]. Saber: PNG/ZIP/PDF/CBZ [S1].
- Không tool nào dùng trang export riêng: đều là menu/dialog.

### 2.11 Phím tắt phổ biến
| Hành động | BT | MTU | Saber edit | Koharu |
|---|---|---|---|---|
| Trang trước/sau | A/D, PgUp/Dn | A/D | A/D | click rail |
| Undo/Redo | Ctrl+Z/Y | Ctrl+Z/Y | – | Ctrl+(Shift)+Z |
| Zoom | Ctrl+wheel, Ctrl +/- | wheel | +/-, 0 | Ctrl+wheel, `0` fit |
| Chuyển block | Alt+Arrow/WASD | – | nút | – |
| Xoá | – | Del | Del/Backspace | – |
| Pan | – | – | – | Space/chuột giữa |
| Brush size | – | Shift+wheel | wheel | Alt+wheel |
| Export / Apply | – | Ctrl+Q | Ctrl+Enter (áp dụng + sang ảnh) | – |
| Hủy thao tác | – | Esc | Esc | Esc |
Rule chung: phím đơn không kích hoạt khi đang gõ trong ô text [K4][MTU-sc][S-edit].

### 2.12 Strip dài (webtoon) — **chưa có tool nào giải xong**
- BT: "thích ứng ảnh tỉ lệ cực" (tính năng, không mô tả UI) [BT-en].
- CT: Webtoon mode, "virtual page", nhưng lỗi patch inpaint biến mất khi cuộn [CT-rel][CT-i470], lỗi trang dài [CT-i475].
- Koharu: issue "Webtoon (long canvas) handling" mới ở mức "investigate" [K-i1163].
- Transmonkey: hỗ trợ tới 10.000px (directory, chưa xác minh) [WS-mtl].
- => Phải tự thiết kế (xem 3.4). Rủi ro cao nhất của dự án; nên khảo sát xem owner nhận ảnh upload dạng strip nguyên hay đã cắt sẵn.

---

## 3. Đề xuất cho app của mình

### 3.1 Nguyên tắc
1. Chương là đơn vị làm việc. Mọi thứ (upload, AI, sửa, duyệt, xuất) xảy ra trong MỘT màn "Chương", không có route upload/export riêng. (học Koharu: import ở menu + rail rỗng có nút Import [K-qs]; học BT: mở folder là chạy.)
2. Một nút chính theo trạng thái chương: "Tải ảnh" -> "Dịch chương" -> "Duyệt" -> "Xuất".
3. Phân biệt ba cấp: Series (cài đặt/glossary) > Chương (pipeline, khoá) > Trang/Strip (canvas).
4. Danh sách text toàn chương là "màn hình sửa chính" song song với canvas (khoảng trống mục 2.5).
5. Không dựng 2 chế độ Translate/Edit (phản mẫu Saber).

### 3.2 Sitemap (3 màn + 2 drawer)

```
/                         Workspace + danh sách series (home, kéo-thả ảnh/ZIP vào thẻ series = tạo chương nháp)
/s/:series                Series: lưới chương + tab Glossary | Cài đặt (font, xưng hô)
/s/:series/c/:chapter     CHƯƠNG = EDITOR GỘP  (query ?page=12 hoặc #p12, KHÔNG phải route riêng)
   ├ drawer "Xuất"        (không phải trang)
   └ drawer "Hoạt động"   (task queue)
```
Từ 7 bước hiện tại xuống: Home -> Series -> Chương (3 cú click, hoặc 1 nếu "Tiếp tục chương gần nhất" trên home).

### 3.3 Workflow ít bước nhất: "thả file -> xuất"

| # | Hành động người dùng | Hệ thống | Ghi chú |
|---|---|---|---|
| 1 | Thả ZIP/ảnh lên thẻ series (home) hoặc vào vùng rail rỗng | Tạo chương, sắp xếp natural sort (`page2` trước `page10`, như Koharu [K1]) | Hỏi tên chương inline, không dialog nhiều bước |
| 2 | Bấm "Dịch chương" (nút primary duy nhất) | Detect -> OCR -> inpaint -> dịch theo chương (glossary series) -> dán chữ; commit theo stage | Trong lúc chạy, trang xong là xem/sửa được ngay (CT làm như vậy [CT1]) |
| 3 | Duyệt: bảng text (tab "Bản dịch") + canvas | Sửa dòng trong bảng -> canvas cập nhật; Enter = dòng sau | Khoá chương khi mở sửa, hiển thị ai đang giữ |
| 4 | Chỉnh typeset những chỗ lỗi trên canvas (text box, brush) | Lưu tự động, không nút Save | |
| 5 | Bấm "Xuất" -> chọn PNG/ZIP/CBZ -> tải | Server tạo, thông báo ở drawer Hoạt động | Mặc định: cả chương |

### 3.4 Wireframe 1 — Home / Series

```
+----------------------------------------------------------------------------------+
| [Logo]  Workspace: Team A v        [ Tìm series... ]            [Hoạt động 2] [Av]|
+----------------------------------------------------------------------------------+
|  Tiếp tục:  [ Tower of God  Ch.112  64% duyệt  >> Mở ]                            |
|                                                                                   |
|  Series                                                  [ + Series mới ]         |
|  +-------------+ +-------------+ +-------------+  +------------------------+    |
|  | [cover]     | | [cover]     | | [cover]     |  |  Thả ZIP / ảnh vào đây |    |
|  | Tower of God| | Solo Lv...  | | Omniscient..|  |  để tạo chương mới     |    |
|  | 112 chương  | | 45 chương   | | 30 chương   |  |  (chọn series sau)     |    |
|  | 3 đang dịch | | 1 đang khoá | |             |  +------------------------+    |
|  +-------------+ +-------------+ +-------------+                                  |
+----------------------------------------------------------------------------------+

Series page:
+----------------------------------------------------------------------------------+
| < Series   Tower of God            [Chương] [Glossary 84] [Cài đặt]  [+ Chương]   |
+----------------------------------------------------------------------------------+
| Ch.112  [########--] 80%  AI xong 54/54  Duyệt 43/54   khoá: @lan   [Mở] [Xuất]   |
| Ch.111  [##########] 100% Đã xuất                                    [Mở] [Xuất]  |
| Ch.113  (chưa tải ảnh)  [ Thả ảnh vào hàng này hoặc bấm Tải ]                     |
+----------------------------------------------------------------------------------+
```
- Thẻ "Thả vào đây" và hàng chương rỗng thay trang upload riêng. Mỗi hàng chương hiện trạng thái pipeline, người khoá, tiến độ duyệt (cái hiện nằm rải ở 2 trang).

### 3.5 Wireframe 2 — Chương = editor gộp (màn trọng tâm)

```
+--------------------------------------------------------------------------------------------+
| < Tower of God / Ch.112      [Dịch chương v]  [AI: 54/54 xong]     [Gốc|Dịch|Chia đôi] [Xuất]|
+---------+-------------------------------------------------------------+----------------------+
| TRANG   |  Toolbar nổi: [V chọn][T text][B brush][E tẩy][R re-OCR]    | [Thuộc tính | Cleanup] |
| (rail)  |                                                             |                      |
| filter  |   +-----------------------------------------------+        | Block #7 (Thoại)     |
| [x] lỗi |   |                                               |        | Gốc:  뭐야 이건?     |
| +-----+ |   |                canvas react-konva              |        | [ OCR lại ]          |
| |p01 v| |   |           (strip dọc cuộn liên tục,           |        | Dịch: Gì thế này?    |
| |p02 v| |   |            click box = chọn)                  |        | [ Dịch lại ]         |
| |p03 !| |   |                                               |        | Font [v] Cỡ [auto]   |
| |p04 .| |   +-----------------------------------------------+        | Căn [<][=][>] Viền   |
| |p05 .| |                                                             | [Áp style cho n block]|
| | ... | |  Zoom 100%  [Fit]     Trang 3/54    o: giữ xem gốc          |                      |
+---------+-------------------------------------------------------------+----------------------+
| BẢNG VĂN BẢN CHƯƠNG (thu gọn được, kéo cao):  tab [Bản dịch] [Glossary] [Tìm/Thay]          |
| # | Tr | Gốc                  | Dịch (sửa tại chỗ)           | Loại   | TT                     |
| 6 | 02 | 이건 뭐지?            | Cái gì đây?                  | Thoại  | v duyệt                |
| 7 | 03 | 뭐야 이건?            | Gì thế này?                  | Thoại  | ! chưa vừa box         |
| 8 | 03 | 쾅!                   | RẦM!                         | SFX    | .                      |
+--------------------------------------------------------------------------------------------+
```
Hành vi chính:
- Rail trái: thumbnail + chấm trạng thái (. chưa, v xong, ! lỗi/cần xem), checkbox lọc "chỉ trang lỗi". Chọn nhiều trang cho thao tác theo phạm vi (như Koharu [K1][K2]).
- Menu "Dịch chương v": Toàn chương (mặc định), Trang đang chọn, Trang đã chọn, + stage nâng cao (Detect, OCR, Dịch, Inpaint) theo mô hình [K2]. Rerun giữ text đã sửa tay.
- Bảng văn bản: click dòng -> canvas cuộn tới block và chọn nó, và ngược lại. Sửa ô "Dịch" cập nhật canvas ngay. Cột TT gắn cờ "tràn box" (tự auto-fit trước). Tab Tìm/Thay: find&replace toàn chương + **preview dòng khớp trước khi áp** [MTU1][T1]. Tab Glossary: gán term -> thay hàng loạt.
- Chế độ xem: Gốc / Dịch / Chia đôi (đối chiếu đồng bộ cuộn [S-edit]); phím giữ `O` xem tạm bản gốc.
- Phím: A/D hoặc PgUp/Dn trang, Alt+↑/↓ block (BT [BT1]), Enter/Shift+Enter dòng sau/trước trong bảng, V text dọc/ngang (nếu cần), Ctrl+Z, Space kéo canvas, Esc huỷ [K4][MTU-sc]. Phím đơn tắt khi đang gõ.
- Strip dài: cuộn liên tục ở canvas, virtualize theo trang/đoạn (chỉ render Konva stage cho vùng đang thấy; mask/patch phải lưu theo toạ độ strip để không mất khi cuộn — đúng lỗi CT [CT-i470]). Thumbnail trong rail là "cắt đoạn" nếu 1 ảnh strip rất dài. Cần chốt với owner: dữ liệu là strip nguyên hay đã cắt.
- Khoá chương: banner trên cùng "Bạn đang sửa — hết hạn sau 10 phút không thao tác" / "@lan đang sửa (chỉ xem)".

### 3.6 Wireframe 3 — Xuất (drawer phải, không đổi route)

```
                                              +--------------------------------+
   (editor vẫn thấy phía sau, mờ)             | Xuất Ch.112                  x |
                                              |                                |
                                              | Phạm vi   (o) Cả chương (54)   |
                                              |           ( ) Đã chọn (3)      |
                                              |           ( ) Chỉ đã duyệt     |
                                              | Định dạng [PNG ZIP v]          |
                                              |           PNG ZIP | CBZ | PDF  |
                                              | Tên file  0001_p01.png ...     |
                                              |                                |
                                              | ! 4 block chưa duyệt, 1 tràn box|
                                              |   [ Xem các dòng đó ]          |
                                              |                                |
                                              |        [ Huỷ ] [ Xuất ]        |
                                              +--------------------------------+
   Sau khi bấm: drawer "Hoạt động": Xuất Ch.112  [#####---] 60%  -> [Tải xuống]
```
- Scope & đặt tên số thứ tự như Koharu [K5]; cảnh báo trước khi xuất là thêm giá trị (chưa tool nào có). PSD chỉ thêm nếu nhóm thực sự dùng Photoshop để hậu kỳ (Koharu/Torii/MTU đều có [K5][T1][MTU1]) — YAGNI cho MVP.

### 3.7 Ưu tiên triển khai (xếp hạng)
1. Gộp upload + chương + editor vào 1 màn, bỏ route per-page (giải phàn nàn "không hình dung được workflow").
2. Nút "Dịch chương" duy nhất + task nền + trạng thái từng trang trong rail.
3. Bảng văn bản chương (sửa tại chỗ, đồng bộ canvas) — khác biệt cạnh tranh.
4. Find&replace + glossary áp hàng loạt có preview.
5. Chế độ Gốc/Dịch/Chia đôi + phím giữ `O`.
6. Scope x stage nâng cao + rerun giữ edit tay.
7. Export drawer với cảnh báo.
8. Thứ tự sau: PSD, translation memory, agent/MCP (Koharu có [K-readme]) — chưa cần.

### 3.8 Rủi ro / đánh đổi
- Bảng văn bản + canvas + rail trên màn nhỏ: cần panel thu/gập, mặc định ẩn bảng ở laptop 13".
- Auto-save + khoá chương: cần chốt xung đột khi AI chạy lại trong lúc có người sửa (Koharu giải bằng "1 job tại một thời điểm, import bị chặn khi đang chạy" [K2]).
- Tách "phần AI" thành 4 stage cho người dùng thấy làm tăng độ phức tạp: để ẩn sau "Nâng cao".
- Rerun giữ edit tay cần cờ `edited` trên mỗi block (Koharu làm theo [K2]) — ảnh hưởng schema.

---

## 4. Nguồn

Repo / docs chính thức (độ tin cậy cao):
- [K-readme] Koharu README: https://github.com/koharu-rs/koharu (Apache-2.0, commit 2026-10-19 theo `gh repo view`)
- [K-shot] Ảnh chụp Koharu: https://raw.githubusercontent.com/koharu-rs/koharu/main/packages/docs/screenshot.png (đã xem trực tiếp: page rail, toolbar dọc, inspector Layers)
- [K1] https://koharu.rs/guides/projects  | [K2] https://koharu.rs/guides/processing | [K3] https://koharu.rs/guides/review | [K4] https://koharu.rs/guides/canvas | [K5] https://koharu.rs/guides/export | [K-qs] https://koharu.rs/quickstart
- [K-i995] https://github.com/koharu-rs/koharu/issues/995 | [K-i592] https://github.com/koharu-rs/koharu/issues/592 | [K-i1163] https://github.com/koharu-rs/koharu/issues/1163 | glossary đề xuất https://github.com/koharu-rs/koharu/issues/339
- [BT1] BallonsTranslator README/EN: https://github.com/dmMaze/BallonsTranslator (shortcut, find/replace, glossary, LLM context) ; [BT-en] https://github.com/dmMaze/BallonsTranslator/blob/dev/README_EN.md (webtoon, search/replace)
- [CT1] comic-translate README: https://github.com/ogkalu2/comic-translate (Manual/Automatic, phím điều hướng) ; [CT-shot] ảnh https://i.imgur.com/QUVK6mK.png (đã xem: nút stage trên cùng, ô Source|Target phải) ; [CT-rel] https://github.com/ogkalu2/comic-translate/releases (v2.8.5-2.8.8 webtoon) ; [CT-i470] https://github.com/ogkalu2/comic-translate/issues/470 ; [CT-i475] https://github.com/ogkalu2/comic-translate/issues/475 ; [CT-i326] https://github.com/ogkalu2/comic-translate/issues/326
- [MTU1] manga-translator-ui README: https://github.com/hgmzhn/manga-translator-ui ; [MTU-sc] https://hgmzhn.github.io/manga-translator-ui/zh/desktop/editor/shortcuts
- Saber: [S1] README https://github.com/MashiroSaber03/Saber-Translator ; [S-shot] https://raw.githubusercontent.com/MashiroSaber03/Saber-Translator/main/pic/interface.png (đã xem: cột nút màu dọc) ; [S2] https://raw.githubusercontent.com/MashiroSaber03/saber-docs/main/zh/use/pages.md ; [S-edit] https://raw.githubusercontent.com/MashiroSaber03/saber-docs/main/zh/translation/edit-mode.md ; [S-task] https://raw.githubusercontent.com/MashiroSaber03/saber-docs/main/zh/use/task-center.md
- manga-image-translator: https://github.com/zyddnys/manga-image-translator (README: web mode cổng 8000, Old/New UI; mô tả repo ghi "cotrans ... no longer working")
- ImageTrans docs: [IT1] https://imagetrans.readthedocs.io/en/latest/gettingstarted.html
- MangaTranslator (Gradio, meangrinch): https://github.com/meangrinch/MangaTranslator — web UI tab Translator/Batch, Config; không có tài liệu webtoon
- TypeR: [TR1] https://github.com/ScanR/TypeR (fork của Swirt/typertools-src)

Thương mại / thứ cấp (độ tin cậy thấp-trung bình, vendor/directory):
- [T1] Torii: https://toriitranslate.com/ ; extension/App Store listing qua WebSearch
- Ichigo Reader: https://chrome.google.com/webstore/detail/ichigo-reader%F0%9F%8D%93/lepcfgkehgeiblekejomdmdklmjdmflp (4.1/5, 329 đánh giá, phàn nàn chữ tràn bubble)
- [WS-mtl] directory: https://www.toolmage.com/en/tool/mangatranslator/ ; https://topai.tools/s/manhwa-translator
- Google Lens/Yandex: https://blog.openl.io/best-manga-translator-2026 ; https://www.imagetranslate.com/blog/yandex-image-translate-vs-imagetranslate (đối thủ viết, thiên vị)

---

## 5. Hạn chế của nghiên cứu (và vì sao quan trọng)

- Không xác minh được layout bên trong của BallonsTranslator (ảnh README là GIF thao tác, chỉ thấy thanh icon trái/status bar; panel phải mô tả qua README) và ImageTrans (chỉ qua doc text, không xem ảnh). Cột layout cho 2 tool này mức trung bình.
- MangaTL/mangatranslator.ai/Cotrans: không tìm được trang chính thức mô tả editor; Cotrans đã ngừng. Không đưa vào căn cứ thiết kế.
- Reddit: tìm không có thread so sánh nào; "khen/chê" lấy từ GitHub issues + review Chrome Store (mẫu nhỏ, thiên lệch người báo lỗi).
- Không tự chạy tool nào; không đo hiệu năng strip dài.
- Phím tắt/Layout web của Torii, MangaTL: chỉ từ marketing.
- Những khẳng định "chưa tool nào có bảng nguồn–dịch toàn chương" dựa trên các doc đã đọc; có thể tồn tại trong fork/commit mới mà doc chưa nhắc.

## Câu hỏi chưa giải quyết (cho owner)
1. Ảnh đầu vào là strip dọc nguyên (1 ảnh vài chục nghìn px) hay đã cắt thành nhiều ảnh? Quyết định thiết kế canvas (3.5).
2. Nhóm có hậu kỳ trong Photoshop (cần PSD) hay xuất PNG/CBZ là đủ?
3. Duyệt (review) có nhiều vai trò (dịch -> proofread -> typeset -> QC) hay một người làm tất? Ảnh hưởng trạng thái "duyệt" ở rail/bảng.
4. Khoá chương: theo người hay theo phiên, và AI rerun có bị chặn khi có người đang sửa không?
5. Màn hình mục tiêu chính (laptop 13" hay màn lớn)? Quyết định có hiện bảng văn bản mặc định hay không.
