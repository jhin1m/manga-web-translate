# Review nhánh feat/ui-simplify (d581933..3ce279e)

**Điểm: 7/10.** 0 critical, 6 warning, 8 suggestion. Không nên merge trước khi sửa W1 và W2.

Đã chạy: typecheck xanh, biome xanh, unit web 417/417. Không chạy e2e theo yêu cầu, nên mọi kết luận về e2e là đọc spec. Ký hiệu: **XN** = đã xác nhận (đọc code hoặc mô phỏng hàm thuần), **NG** = chỉ nghi ngờ, chưa chạy trên trình duyệt.

## Critical

Không có. Không tìm thấy đường mất dữ liệu đã lưu hay đổi contract.

## Warning

**W1. AI có bản mới bị giấu sau khi đóng panel Văn bản, không còn dấu báo (XN).** `chapter-workspace.tsx:327` chỉ mở panel khi `content` chuyển false → true và `panelRef === null`. Đóng panel Văn bản (`:949-953`, `:1155-1159`) không kiểm lại `hasToolContent`. Băng `:1139` chỉ báo xung đột, không báo AI.
Tái hiện: mở Văn bản, bấm một dòng thuộc trang có "AI có bản mới" (hoặc đứng ở trang đó rồi mở Văn bản), đóng Văn bản. Panel null, `AiUpdatePanel` không render, không băng nào hiện. Trái `phase-03` mục 9 và mục Rủi ro ("không được mất khỏi tầm nhìn"). Spec chỉ phủ trường hợp panel đang đóng.
Sửa: khi đóng Văn bản mà `hasToolContent` đúng thì chuyển sang `tool`, hoặc thêm băng như xung đột.

**W2. Nút "Hoàn tác" của "Bỏ chỉnh sửa tay" gọi `undo()` trần (XN).** `chapter-workspace.tsx:838-843`: không gắn với trang, không tự ẩn sau khi bấm (`NoticeRow:1443`), bỏ qua `batchOnTop` mà `undoEdit:590-597` có kiểm. Toast sống 6 giây. Lịch sử undo theo trang (`store.ts:134-143`).
- Bấm 2 lần: lần 2 hoàn tác thêm một sửa tay cũ. Ẩn nhưng vẫn thành save "dirty" rồi autosave.
- Bỏ sửa ở trang 3, sang trang 4, bấm Hoàn tác: mất bước cuối của trang 4, trang 3 không về.
- Trang 4 có mốc lượt ở đỉnh (Tìm/Thay, Áp kiểu): `undo()` bóc mốc (`history.ts:46-53`, mốc có patch rỗng `:66`) mà không gọi `undoBatch`. Cmd+Z sau đó áp patch của state trước lượt lên state sau lượt.
Sửa: toast nhớ `pageId`, bấm là đóng, khác trang thì không làm gì, đi qua `undoEdit`.

**W3. Tự cuộn lộ khối bị ghi đè khi khung đổi cỡ ở chế độ vừa khung (XN bằng mô phỏng hàm thuần).** `ChapterCanvas.tsx:143` gọi `clampView({scale, x:0, …})`, không có `cover`, chạy sau subscriber `unsubBox` (`chapter-workspace.tsx:983-985`) và không có lần reveal nào sau đó.
Tái hiện: Văn bản đang mở, chọn khối sát mép trái, bấm Chọn. Mô phỏng khung 600→1160, khối x=20 rộng 200: trang 800×2400 khối ở 200-400px, trang 1600×1200 khối ở 115-234px, đều dưới panel 272px; `revealBlockView` gọi lại sẽ sửa được. Spec duy nhất cho đường này (`rail-text-export.spec.ts:142`) bấm 100% trước nên đi nhánh zoomed. Kéo đổi cỡ cửa sổ khi panel mở cũng cùng đường.
Liên quan: nút % (`chapter-store.ts` `fitView`) và bật Chia đôi cũng không reveal, khối vẫn cuộn ra được bằng tay (mức suggestion).

**W4. Nhấp đúp sửa trên ảnh hỏng với khối nằm trong vùng panel sắp đè (NG, suy từ code).** Từ panel đóng, lần nhấn đầu chọn khối, nhả chuột mở panel (`chapter-workspace.tsx:333`), panel z-index 10 phủ con trỏ (CSS `:279`), lần nhấn hai rơi vào panel nên `onDblClick` (`TextBoxNode.tsx:73`) không chạy. Nếu khối chỉ chạm vùng 296px thì reveal còn dời ảnh giữa hai lần bấm. Áp dụng khi x màn hình < 272px, thường gặp với trang ngang và zoom 100%. `editor.spec.ts:747` có nhấp đúp nhưng khối của nó (`tb` dòng 711) theo tính toán nằm ngoài vùng panel nếu fixture là trang dọc (chưa đo). Trái `phase-03` mục 7. Enter và ô Dịch vẫn dùng được. Cần kiểm tay một lần.

**W5. Bấm lại đúng khối đang chọn không mở panel (XN).** `TextLayer.tsx:56` gọi `select(id)` cùng giá trị nên nhánh mở panel ở `chapter-workspace.tsx:328` không chạy. Tái hiện: chọn khối, bấm ×, bấm lại khối. Hoặc: chọn khối, phím B (panel thu ở `chapter-workspace.tsx:343`, selection còn), phím V, bấm khối. Trước đây thanh nổi "Sửa chữ" lo việc này. Còn đường rail Chọn và Enter.

**W6. Sót đổi nhãn Mask/OCR, plan `phase-03` mục 5 chưa xong (XN).** `editor/shortcuts.ts:48` hiện "Mask · Tẩy mask · OCR vùng" trong bảng phím tắt (`?`). `lang-pair-popover.tsx:37` hiện "dùng công cụ OCR". Spec chỉ quét chữ "Export".

## Suggestion

- **S1.** `export-menu.tsx:78`: danh sách phần tử gồm cả ô trong `<details>` đang đóng, nên khi Tuỳ chọn thu gọn và không có "Tải lại", Tab từ dòng Tuỳ chọn rời menu mà menu vẫn mở. Báo cáo phase 5 ghi "Tab ra ngoài đóng" nhưng không spec nào kiểm. Lọc bằng `checkVisibility()`.
- **S2.** `chapter-workspace.tsx:939`: query hiệu đính chạy mỗi lần mở chương đã xong và mỗi lần cửa sổ lấy lại focus (`router.tsx:31`), trong khi nhãn "Hiệu đính · N" chỉ thấy khi đã mở Văn bản. Đổi `enabled` thành `canTools && seenTabs.size > 0`.
- **S3.** Hộp xác nhận Hiệu đính nay giữ mount: `confirming` còn đúng khi chuyển tab, giá ước tính cũ vẫn hiện khi quay lại và query estimate refetch khi focus dù tab ẩn. Đóng hộp khi rời tab.
- **S4.** Sau reveal, đóng panel thì ảnh giữ lệch tới ~296px đến lần cuộn kế rồi giật về (`setCover(0)` không clamp lại, người làm đã ghi nhận). Clamp lại khi `cover` về 0.
- **S5.** Chương chưa cắt trang: rail Chọn mở panel đè ảnh gốc chỉ có câu "Chưa có trang để sửa." (`select-panel.tsx`), vô ích từ khi bỏ `SourcePanel`. Tắt panel ở `sourceMode`.
- **S6.** Code chết sau khi xoá: CSS `.cw-flags`, `.cw-page-line`, `.cw-panel-sub`, `.cw-seg` (workspace), `.ed-mask`, `.ed-steps` (editor.css), `.drawer-warn` (drawer.css). Wrapper thừa `setPanel:198`, alias `view:938`.
- **S7.** Trùng lặp: `timeAgo` ở `export-panel.tsx:76` viết lại `lib/format.ts:7`, khác kết quả với mốc xa ("3 ngày trước" và "12/10"). `lang-pair-popover.tsx` chỉ còn phần ô chọn, tên file sai.
- **S8.** Comment lỗi thời: `chapter-workspace.tsx:702` ("panel Chọn = ảnh gốc"), `export-options.ts:2,13` ("drawer"), `ChapterCanvas.tsx:126` ("panel 288 ↔ 560"). Không thấy số phase hay mã plan trong comment.

## Đối chiếu plan (mục a)

| Tiêu chí plan.md | Kết quả |
|---|---|
| Canvas 1160 ở 1280, không chọn gì | Đạt theo CSS (`48px auto 1fr 72px`) và assertion spec |
| Thanh trên tối đa 8 mục | Đạt ở đọc code: đang chạy đúng 8 mục (undo, redo tính riêng; chưa tính chỉ báo lưu khi nó hiện, spec chỉ đếm mục bấm được) |
| Mỗi thao tác một chỗ, chuột phải = ⋯ | Đạt, cùng `menuItems` |
| Không còn chữ "Export" | Đạt, chỉ còn tên biến, comment và nội dung kỹ thuật ở docs |
| Docs khớp UI | Đạt ở `editor.md`, `design-guidelines.md`; không còn tham chiếu symbol đã xoá |

Phase 1, 2, 4, 5: đủ mục, trừ các lệch nêu ở "Cần user quyết". Phase 3: thiếu W6, W1 và W4 trái yêu cầu.

## Regression và contract (mục b, c)

Đã kiểm, không thấy lỗi:
- Đường tới của mọi thao tác đã chuyển chỗ, kể cả phím: thao tác khối, thao tác trang (⋯, chuột phải, Shift+F10), xoá ảnh gốc, huỷ xuất qua Hoạt động.
- Đổi trang qua chip đi qua `activate` nên lưu trước. Xuất vẫn `flush` trước khi gửi.
- Ctrl+F lần đầu focus được: `ContextPanel` chạy effect mỗi render nên đợi tab mount. Panel và tab ẩn đúng nhờ `.cw-panel-body > [hidden]` và `.cw-panel-doc > [hidden]`.
- Xung đột khi lưu: tự mở, không tự đóng, băng khi thu.
- Chỉ xem, trang bận, khoá: nút khối và menu trang tắt đúng lý do.
- Listener được gỡ; `{once:true}` có thể sót nhẹ sau `pointercancel` nhưng vô hại.

Tạm dừng hết ngân sách của xuất: `chapter.export` không nằm trong job tốn tiền (`packages/shared/src/job.ts:30`), hiện server không đưa job xuất vào trạng thái này, nên việc bỏ danh sách lượt xuất không gây mất thông tin thực tế.

Contract: diff chỉ đụng `apps/web` và `docs`. Không đổi API, DB, worker, env, route. localStorage chỉ đổi `mtl.layout` (xoá) đúng plan. `click-budget.spec.ts` không đổi.

## Test (mục e)

- Không thấy assertion bị nới sai ý. Các đổi đều theo nhãn hoặc plan. `chapter-tools.spec.ts:322,328` đổi `"Ẩn trang 2"` thành `menuitem.first()`: mất tên nhưng còn ý focus mục đầu. `.status "Đã lưu"` chuyển sang vùng live, vẫn gắn với `save.status`.
- Spec xung đột (`block-panel.spec.ts:220`) đặt thẳng vào store, không đi qua lượt lưu 409 thật. Luật rebase có unit nhưng đường 409 → panel tự mở không được kiểm đầu cuối.
- Thiếu test cho rủi ro: W1, W2, W3 (vừa khung), W4, W5, S1.
- `doc-tabs.test.ts`, `canvas-controls.test.ts` chỉ kiểm chuỗi nhãn. Logic tự mở/đóng panel chỉ có e2e vì `hasToolContent` và subscriber nằm trong component.

Tiếp cận: tooltip rail mở bằng `:focus-visible`, ⓘ mở bằng focus, focus trả về đúng với ⋯ và menu Xuất, `aria-label` đủ. Tồn tại: Esc không ẩn tooltip, trong modal Esc đóng cả modal. Nút rail bị tắt không focus được nên lý do không tới được bằng phím.

## Cần user quyết (side effect)

1. **Không nhớ panel nào qua tải lại, kể cả Văn bản.** Plan chỉ yêu cầu bỏ giá trị cũ của `mtl.layout`, người làm bỏ luôn việc ghi nhớ. Người hay làm ở bảng Bản dịch tốn thêm 1 bấm mỗi lần mở chương. Giữ, hay nhớ riêng Văn bản?
2. **Bỏ danh sách lượt xuất và nút Huỷ khỏi menu Xuất**, chỉ còn ở Hoạt động. Khi đang xuất mà chương có trang cần xem, chip nhảy trang nên phải vào ⋯ → Hoạt động. Lượt lỗi cũ cũng không còn hiện ở menu. Plan viết "giữ nguyên luồng xuất".
3. **Rail Chọn từ công cụ khác luôn mở panel**, kể cả không chọn khối, đè 272px chỉ để hiện một câu gợi ý; phím V thì không mở. Nên chỉ mở khi có khối hoặc nội dung?
4. **`phase-01` mục 5 "bỏ breadcrumb (nút ‹)"**: code thay breadcrumb bằng nút ‹ về home. Nếu ý là bỏ cả nút thì chưa đúng. Không mở được wireframe để đối chiếu.
5. **"N chỗ cần xem" thay "N trang cần xem"** ở menu Xuất. Hợp lý vì số đếm trộn trang và khối, nhưng khác chữ plan.
6. **Hàng chương bỏ dòng chi tiết**, nội dung chỉ còn ở `title`, màn cảm ứng không xem được. Lý do dài ở `LockBand` cũng vậy.

## Ghi chú ngoài phạm vi

Working tree có `apps/web/e2e/upload-chapter.spec.ts` sửa chưa commit (+57 dòng) không thuộc range, có thể của lượt khác. `qa-before-delete.png` nằm lạc ở gốc repo. Thư mục plan chưa được track.
