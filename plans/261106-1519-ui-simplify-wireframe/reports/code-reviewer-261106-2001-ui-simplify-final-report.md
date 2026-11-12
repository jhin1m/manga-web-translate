# Review cuối feat/ui-simplify (7d01924..8ccade0)

**Điểm toàn nhánh: 7.5/10. 1 critical, 2 warning, 5 suggestion.** Không nên merge khi chưa sửa C1 hoặc user chưa chấp nhận rõ (sửa khoảng 3 dòng).
Chỉ đọc code, không chạy gì. **XN** = xác nhận bằng đọc code, **NG** = chỉ nghi ngờ. Tự kết luận trước, sau đó mới đối chiếu report của người sửa.

## Critical
**C1. Hoàn tác bị hoãn chỉ nằm trong bộ nhớ, tải lại là mất, dù toast hứa sẽ khôi phục (XN).** `use-chapter-session.ts:281-283,289-291,303-305`; `chapter-workspace.tsx:900-902`.
- Kịch bản: trang 3 có sửa tay → Bỏ chỉnh sửa tay → sửa lại đúng ô đó → sang trang 4 → Hoàn tác. Rebase xung đột, toast báo "sửa tay sẽ được khôi phục khi bạn mở trang này". Đóng tab, tải lại hoặc về Series trước khi mở trang 3: sửa tay mất hẳn.
- Lý do: bản ghi chỉ vào `this.deferred`, không vào IndexedDB (`SessionDeps.queue` chỉ có `delete`). Bản AI đã lưu nên `beforeunload` không cảnh báo, lần mở sau không có gì để khôi phục. Comment `:236` "IndexedDB vẫn còn bản ghi" sai với caller mới. Trang bận cũng dính nếu rời đi trước khi lô xong.
- Tần suất thấp (cần đổi trang trong 6 giây và xung đột hoặc bận). Không tệ hơn trước fix, vì trước đó Hoàn tác không làm gì, nhưng giờ UI hứa điều code không giữ.
- Sửa: `await queue.put(rec)` trước khi hoãn, mở rộng `Pick<PendingQueue, "delete" | "put">`. Lượt sau sẽ hiện hộp khôi phục.

## Warning
**W1. Mở lại trang sau khi hoãn vẫn giữ lịch sử undo cũ; Cmd+Z có thể ghi vào sai khối (XN đường code, chưa chạy).** `use-chapter-session.ts:155-160,427-436`; `store.ts:223`.
- Đường xung đột: version không đổi nên stash được nạp lại, `rebased(s.base, ...)` có `same(server, s.base)` nên giữ history trong khi doc đã khác. `:140-141` đã nêu đúng bất biến này ("lịch sử undo cũ không còn khớp, bỏ"), đường mới không tuân theo.
- Kịch bản: `[A,B,C,D]`, tay xoá A, sửa C → Bỏ sửa tay → sửa C lần nữa → sang trang khác → Hoàn tác → mở lại → doc `[B,C,D]`. Cmd+Z chạy patch `text_boxes/2/text` nên ghi chữ AI của C vào D rồi tự lưu. Nếu index vượt mảng thì immer ném lỗi. Xếp warning vì cần đủ chuỗi điều kiện này.
- Sửa: xoá stash của trang khi hoãn (`stash.delete(rec.pageId)`), như `:141`.

**W2. Hoãn mở panel chỉ xét mép trái; panel mở còn dời ảnh theo chiều dọc và mép phải (XN đường code, mức ảnh hưởng chưa chạy).** `chapter-store.ts:242` so với `page-layout.ts:117-118`.
- Kịch bản: webtoon hoặc 100%, khối x ≥ 296 bị cắt ở đáy khung (hoặc cách mép dưới 24px). Lần bấm đầu mở panel ngay, reveal dời ảnh. Nếu dời đủ xa, lần bấm hai rơi xuống nền → bỏ chọn, panel đóng: đúng triệu chứng lỗi cũ.
- Sửa: hoãn cả khi `revealBlockView` với cover sắp tới trả khác null. Spec hiện chỉ phủ khối bên trái.

## Từng mục được giao
1. **Nhấp đúp:** spec kiểm thật: tâm 296 < 320, Playwright 1.64 chạy down-chờ-up-chờ-down-chờ-up nên mỗi nhịp 80ms. Konva bắn `dblclick` ở `mouseup`, sau `pointerup` (`Stage.js:662-703`), nên thứ tự đặt timer rồi huỷ là đúng (XN). Timer huỷ đúng khi nhấp đúp, Enter, đổi khối, đổi trang (`load` xoá chọn), Esc, Delete, bấm nền, unmount. Đổi công cụ thì `openToolPanel` tự chặn. Timer không gắn id khối nên không mở nhầm khối; bấm đơn luôn mở. Đua AI/xung đột: panel mở ngay, timer sau đó không làm gì. Xem S1, S2.
2. **Hoàn tác đổi trang:** ngoài C1, W1: không đụng trang đang mở, PUT có `If-Match`, 409 fetch lại rebase 1 lần rồi báo lỗi; toast đóng nên không bấm lần 2 được. **Không ghi đè mù:** sửa thêm cùng field → xung đột, giữ bản mới, liệt kê lúc mở; khác field → gộp; xoá khối → xung đột. Trang 3 mở lại khi PUT đang bay: `syncActive` nạp bản mới, hoặc Saver 409 rồi rebase. Thành công thì version đổi nên lịch sử cũ bị bỏ, không undo đôi.
   Ngoại lệ rất hẹp (XN): `deferred.set` đè bản hoãn cũ. Sửa rồi trang vào bận trước khi lưu, sang trang, Hoàn tác: sửa đó rớt khỏi bộ nhớ, rồi `queue.delete` khi lưu xong.
3. **Phím V:** × rồi V không mở, B rồi V mở, × B V không mở (XN, spec kiểm). Đổi trang không reset ref nhưng vô hại: không còn chọn nên V không mở, rồi ref tự về false. Đổi khối khi đang công cụ khác không có đường qua canvas. Rail Chọn không gãy. Nhẹ: B, rail Chữ, V không mở còn B, phím T, V có mở.
4. **Chữ OCR, docs:** không test hay code nào phụ thuộc chuỗi đã đổi; unit chỉ assert `tự thử lại lúc`, `máy xử lý`, `huỷ`, đều còn. Sót: S3.
5. **Huỷ job:** nhận định của report đúng cho đường chính: có jobId thì cleanup huỷ, POST đang bay thì huỷ sau khi về, route không cần khoá chương, có kiểm chủ job (XN). Report chưa giải thích được lượt đỏ: chưa có network trace, và lượt fail khi chạy tải là lỗi khác. Hai lỗ hổng:
   - XN: `.catch(() => undefined)` tại `OcrSelect.tsx:89,115`. Cancel lỗi một lần (mạng, 5xx lúc tải cao) là job kẹt queued, không thử lại. Worker rảnh sẽ chạy tốn AI, kết quả bỏ.
   - NG: `expect.poll` 5 giây tính từ lúc URL đổi, còn cancel chạy lúc unmount; chương đang chờ router/render khi máy bận sẽ hết giờ dù code đúng. Chưa đọc đủ luồng router.
   Đóng tab hoặc tải lại không huỷ job: đúng thiết kế best-effort.
6. **Regression:** không thấy gãy ở caller của `resetEdits`, `setCover`, `select`. Không có test bị nới: W-B và V đổi assert theo hành vi mới và chặt hơn. Không có mã review hay số phase trong diff. `import Konva` đã có ở `ChapterCanvas.tsx` nên không thêm gói.
## Suggestion
- **S1.** Timer từ lần bấm 1 không huỷ khi nhấn lần 2 rồi giữ/kéo: panel mở giữa lúc kéo, trái comment `chapter-workspace.tsx:300-301` (XN, hiếm). Sửa: khi timer chạy mà `pointerDown` thì đợi `pointerup`.
- **S2.** Spec W-A không kiểm panel vẫn đóng sau 400ms. Timer không huỷ thì spec vẫn xanh, vì `openToolPanel` không xét `editing`.
- **S3.** Docs, comment cũ: `docs/editor.md:197` "như phím V", `chapter-workspace.tsx:322,353` vẫn tả V mở khi còn khối.
- **S4.** Chưa có test cho đường hoãn hoặc lỗi của Hoàn tác đổi trang, nhất là sửa thêm rồi sang trang. Spec Hoàn tác phải xong trong 6 giây (NG chập chờn khi tải cao).
- **S5.** Cùng trang, sửa tiếp rồi bấm Hoàn tác: toast đóng im lặng (`:917-918`), trang khác thì gộp được. Nên báo "Dùng Cmd+Z".
## Đối chiếu report người sửa
Mô tả đúng code ở việc 1, 3, 4. Việc 2 đúng nhưng thiếu: không nhắc độ bền của "sẽ khôi phục" (C1) và stash (W1). "Không thấy lỗ hổng" ở việc 5 đúng cho đường chính, bỏ sót nuốt lỗi. Gate 100/100 không kiểm lại theo yêu cầu.
## Cần user quyết
1. Khối ở dải trái (mép trái dưới 296px): panel mở chậm 400ms, chỗ khác mở ngay. Đề xuất giữ, giá phải trả của nhấp đúp.
2. Nhấp đúp khối dải trái: panel không mở cả sau khi sửa xong, phải bấm lại. Đề xuất giữ.
3. Hoàn tác đổi trang thành công thì mất Cmd+Z các bước cũ của trang đó. Đề xuất giữ.

Status: DONE_WITH_CONCERNS
Summary: W-A, W-B, V đúng ở đường chính và không ghi đè mù, nhưng hoàn tác bị hoãn không bền qua tải lại (C1) và giữ lịch sử undo sai (W1).
