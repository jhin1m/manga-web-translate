# Vòng 3 sửa review feat/ui-simplify

Gate đã chạy: typecheck sạch, biome check các file sửa sạch, vitest editor 207/207, `pnpm --filter @mtl/web test` 52 file / 431 test xanh. Không commit.
Chưa chạy: e2e, Playwright, trình duyệt, docker (theo ràng buộc máy).

## Phải sửa
- **C1 (thật)**: `restoreOther` hoãn chỉ ghi `this.deferred`, không vào IndexedDB. Test đỏ: sau hoãn `queue.get` trả undefined. Sửa: `SessionDeps.queue` là `Pick<PendingQueue,"delete"|"put">`; helper private `defer()` (`use-chapter-session.ts`) gọi `queue.put` cho cả 3 đường hoãn (bận, xung đột, 409 page_busy) và đường hoãn trang bận khi đổi trang. Test (`chapter-session.test.ts`): bản hoãn nằm trong IndexedDB; bản đọc lại đi qua `restoreOther` ra "saved" và bị xoá; cùng phiên mở trang -> áp vào editor, lưu xong queue rỗng, không khôi phục lặp; xung đột cũng được lưu. Lỗi ghi IndexedDB ở đường đổi trang chỉ warn (không chặn đổi trang); ở `restoreOther` ném ra nên toast Hoàn tác báo lỗi thật. Comment `:236` giờ đúng.
- **W1 (thật)**: `defer()` gọi `stash.delete(pageId)`. Test đỏ trước: mở lại trang sau hoãn vẫn còn history, undo chạy patch cũ. Giờ `history.past` rỗng, undo không đổi doc.
- **Mục 3 (thật, sửa gọn)**: `defer()` gộp với bản hoãn cũ: `ops = [...cũ, ...mới]` rồi rebase; field lệch thành xung đột sẵn có (bản sửa mới hơn thắng, bản cũ hiện ở danh sách xung đột). Test: hai bản hoãn khác khối -> mở trang thấy cả hai, queue có ops gộp.
- **W2 (thật)**: thêm hàm thuần `revealWouldMove` (`page-layout.ts`) = `coverLeft>0 && revealBlockView(...) !== null`; `selectionUnderCover` (`chapter-store.ts`) dùng nó với đủ khung/page/viewMode nên hoãn mở panel cũng áp khi sắp dời dọc hoặc mép phải. Test `page-layout.test.ts`: dưới panel, cắt đáy, cắt mép phải = true; khối thoáng / không panel = false. Ghi chú: hàm mới viết cùng lúc với test (import chưa có là đỏ), không chạy riêng lần đỏ với hành vi cũ.

## Sửa nếu rẻ
- **S2**: spec nhấp đúp (`e2e/block-panel.spec.ts`) thêm chờ 450ms rồi assert panel vẫn ẩn. **Chưa chạy.**
- **S3**: `docs/editor.md` (mô tả Chọn/phím V) và 2 comment trong `chapter-workspace.tsx` nay nói V chỉ mở lại khi panel vừa thu vì đổi công cụ.
- **S5**: nút Hoàn tác khi đã sửa tiếp cùng trang -> toast info "dùng Cmd+Z (Ctrl+Z)". Không có unit test (logic nằm trong component, không có test harness cho component); chưa chạy e2e.
- **Cancel job (thật, làm)**: `cancelJobBestEffort` (`ocr-wait.ts`): thử lại 1 lần sau 1,5s, hết thì bỏ im. 3 chỗ trong `OcrSelect.tsx` dùng nó. Test đỏ rồi xanh trong `ocr-wait.test.ts` (ok một lần, lỗi rồi ok, lỗi hai lần không ném). Không đụng e2e huỷ job. Phần NG về `expect.poll` 5s không kiểm.

## Không làm / ghi lại
- S1 (timer lần 1 mở panel giữa lúc kéo ở lần bấm 2): không rẻ, cần theo dõi pointer trong timer; để nguyên.
- S4 (test đường hoãn/lỗi của Hoàn tác đổi trang ở mức UI): phần session đã có test mới; phần component không có harness; để nguyên.
- Giữ nguyên các điểm đã chốt: mở panel chậm 400ms ở dải trái, nhấp đúp không tự mở, Hoàn tác đổi trang mất Cmd+Z cũ.

Status: DONE_WITH_CONCERNS
Summary: C1, W1, W2, gộp bản hoãn, S2, S3, S5 và retry cancel OCR đã sửa; phần logic có unit test đỏ rồi xanh, gate unit/typecheck/biome xanh.
Concerns/Blockers: e2e (spec nhấp đúp mới, S5 toast, huỷ job) chưa chạy; S1, S4 chỉ ghi lại.
