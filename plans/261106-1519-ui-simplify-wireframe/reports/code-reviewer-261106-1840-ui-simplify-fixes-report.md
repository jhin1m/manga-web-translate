# Review lượt sửa feat/ui-simplify (db628aa..7d01924)

**Điểm toàn nhánh: 8/10.** 0 critical, 2 warning, 6 suggestion. Nên sửa W-A trước merge hoặc user chấp nhận rõ.
Đã chạy: `tsc --noEmit` web, biome đều xanh. Không chạy e2e, unit theo yêu cầu. **XN** = đã xác nhận (đọc code hoặc probe), **NG** = chỉ nghi ngờ. Có 1 probe chromium độc lập trong scratchpad (`page.setContent`, không cổng, không DB; Konva, React, `revealBlockView` thật, handler chép lại).

## Warning
**W-A. W4 là lỗi thật; kết luận "không phải lỗi" sai, test giữ lại không kiểm kịch bản đó (XN bằng probe + tính hình học, chưa chạy trên app thật).** `e2e/block-panel.spec.ts:307-323`.
- Điểm bấm ngoài panel: trang 720, 100%, khung 1160 → `at.x` = 276, tâm 336, panel kết thúc ở 320. Dòng `:321` chỉ kiểm mép trái.
- `page.mouse.dblclick` không delay: Konva còn dùng hit graph cũ (vẽ lại theo rAF) nên khối vẫn "ở đó" dù reveal đã dời 68px.

| Khối (x, w), tâm màn hình | Không delay (spec) | Delay 20ms | Delay 60ms (như người) |
|---|---|---|---|
| 8, 120, tâm 336 (fixture spec) | OK | FAIL: không nhận nhấp đúp | FAIL: lần 2 rơi xuống nền → bỏ chọn |
| 8, 40, tâm 296 | FAIL: lần 2 vào `ASIDE` | FAIL | FAIL |
| 300, 120 (không reveal) | OK | OK | OK |

Tái hiện: panel thu, trang 100% (hoặc webtoon/trang ngang có mép trái dưới 296px), nhấp đúp khối vùng trái. Theo code: lần 1 chọn + mở panel + dời ảnh; lần 2 trúng panel, hoặc trúng nền rồi panel đóng và ảnh giật về. Trái `phase-03` mục 7. Trang dọc vừa khung ở 1280×800 không dính. Enter và ô Dịch vẫn dùng được.
Sửa: khi panel sắp che/dời khối thì hoãn mở hết `Konva.dblClickWindow` (400ms), huỷ nếu có dblclick. Spec dùng `{ clickCount: 2, delay: 80 }`, kiểm tâm khối nằm dưới panel.
**W-B. Nút Hoàn tác của toast im lặng khi không hoàn tác (XN đọc code).** `chapter-workspace.tsx:864`. Bỏ sửa trang 3, sang trang 4 trong 6 giây, bấm Hoàn tác: toast đóng, không báo gì, trang 3 vẫn mất sửa tay và đã lưu. Người dùng tin là đã khôi phục; tải lại thì mất đường Cmd+Z. Spec `:817` khoá hành vi này. Sửa: báo "Về trang 3 rồi Cmd+Z" hoặc ẩn nút khi đổi trang.

## Từng mục cũ
| Mục | Kết luận |
|---|---|
| W1 | Hết (XN đọc code, spec). × còn AI/xung đột → băng. Đổi trang rồi về: AI tự mở lại hoặc băng báo, không mất dấu. Xung đột mất khi đổi trang như thiết kế, băng đã báo trước |
| W2 | Hết phần nguy hiểm (XN). Bấm 2 lần, đổi trang, sửa mới, xen batch đều không undo nhầm; `resetToAI` trả root mới nên luôn ghi bước. Về đúng trang: stash giữ cùng object nên undo được (chưa có test). Còn W-B |
| W3 | Hết (XN). `setBox` trước render, effect `[size, split]` đứng sau các effect đặt view; zoom, chia đôi, nút % đều reveal. Ctrl+cuộn chỉ kẹp với cover: đúng ý |
| W5 | Hết (XN). Bấm lại, ×, đổi khối rồi quay lại đều mở; spec kiểm thật |
| W6 | Hết ở phím tắt và panel, còn sót S-A |
| S1, S5-S8 | Đạt. 7 class CSS không còn tham chiếu trong `src`, `e2e`, `docs`. `setPanel`, `view`, file đổi tên: không caller hỏng |

## Rail Chọn và phím V
An toàn: gõ trong textarea không kích hoạt (`shortcuts.ts` trả null khi `inField`), giữ phím không lặp, chỉ xem thường là Chọn sẵn nên V không làm gì. Làm phiền ở luồng B → V: xem "Cần user quyết" số 1.
Không nhất quán dù `tool-rail-model.ts:26` ghi "như phím V" (XN, mức nhẹ):
- Công cụ khác, chỉ có AI/xung đột, panel thu: rail mở, V không mở (`chapter-workspace.tsx:337`).
- Đang Chọn, có khối, panel thu: rail mở, V không làm gì.
- Đang Văn bản, có khối: rail chuyển sang panel khối, V giữ Văn bản.

## Suggestion
- **S-A.** Chữ cũ cùng màn với "Đang quét chữ…": `editor/ocr-wait.ts:17,30`, `OcrSelect.tsx:120,122,230`.
- **S-B.** Sai sau S3: `chapter-workspace.tsx:1195`, `docs/design-guidelines.md:75` vẫn nói giữ hộp xác nhận Hiệu đính. `editor.spec.ts:584` ghi "chưa chọn khối" nhưng đang chọn.
- **S-C.** Chọn dòng không khung từ bảng: Esc, bấm nền không xoá `current` (`:1057`, `:343`), nên B → V và rail Chọn luôn mở panel tới khi chọn khối khác (XN đọc code). Hiếm.
- **S-D.** Spec 409 cho xung đột tới khi khối còn chọn; nhánh tự mở khi không chọn khối chỉ còn phủ qua AI (cùng dòng code). Spec Hoàn tác phải xong trong 6 giây của toast, có thể chập chờn khi máy tải cao (NG).
- **S-E.** `ChapterCanvas.tsx:163` reveal trực tiếp, bỏ hoãn khi đang nhấn chuột của subscriber cũ. Băng hiện lúc kéo khối có thể dời ảnh (NG; nhánh refit vốn cũng dời).
- **S-F.** Thêm 1 unit rẻ cho `setCover(0)`: chạy ở mọi lần thu panel, đụng cả `y`. Đọc `clampView` thấy không đổi view vừa khung, không chặn merge.

## Test
- **Rail Chọn (`editor.spec.ts:550-582`, unit):** đổi nghĩa có chủ đích, không nới lỏng. Mọi `openPanel(page, "select")` còn lại đều chọn dòng hoặc khối trước, không gãy theo đọc spec.
- **Xung đột 409:** tốt hơn cũ, 409 thật qua `route.fetch` + `route.continue` với `If-Match` cũ; ý tự mở, ở lại, bỏ chọn vẫn giữ.
- **W1, W2, W3, W5, S1:** kiểm đúng hành vi; đỏ trước xanh sau là theo report sửa, tôi không chạy lại. Full e2e chưa chạy lại sau spec cuối.
- **S2, S3:** rủi ro thấp, không cần thêm (`proofread.spec.ts:52,65` đã phủ nhãn N). **S4:** xem S-F.
## Regression
Không thấy gãy (XN đọc code): caller `select` (`pick` chặn cùng giá trị), `setTool("select")` gồm luồng thêm chữ và `sourceMode`, `fitView` trên store test riêng, `load` đặt `reselects` về 0 (so `>` nên không kích nhầm), `timeAgo` mới khớp `rail-text-export.spec.ts:379`.
## Cần user quyết
1. **V mở lại panel khi còn khối chọn**, kể cả vừa bấm ×. Chọn khối → B tô → V: panel đè 272px, ảnh có thể dời. Giữ, hay chỉ mở lại khi panel thu do đổi công cụ?
2. **Thu Văn bản khi còn AI/xung đột về panel khối**, thu hết phải bấm thêm ×. Theo tôi hợp lý.
3. **Băng AI làm canvas thấp đi** (`grid-template-rows` `auto`): × hoặc Xem khi vừa khung theo chiều cao đổi tỉ lệ ảnh vài % (đọc code, chưa xem thực tế). Xung đột vốn đã vậy.
Status: DONE_WITH_CONCERNS
Summary: W1, W2, W3, W5 hết; W4 là lỗi thật ở tốc độ người bấm và test giữ lại không kiểm được kịch bản.
