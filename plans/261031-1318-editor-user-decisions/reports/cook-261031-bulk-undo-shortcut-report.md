# Cmd+Z hoàn tác lượt sửa nhiều trang (Áp kiểu) — báo cáo

## Thiết kế
- `history.ts`: `HistoryEntry.batch?: BatchMark {id, before, after}` = mốc không patch. `recordBatch` (xoá nhánh redo), `batchOnTop`, `findBatch`, `settleBatch(id, "restored"|"orphaned")`.
- `store.ts`: `markBatch`, `finishBatch(id, restored|orphaned|local|reload)`.
- `ChapterSession.editMany`: giữ lịch sử trước lượt qua lần nạp lại trang đang mở (`carry` đặt TRƯỚC `setCached`, vì subscription chapterStore gọi `syncActive` đồng bộ), rồi cắm mốc cuối lịch sử. `afterBatchUndo(batchId, skipped)` dọn mốc sau `undoBatch`; `dropBatch` khi server từ chối hẳn.
- `chapter-workspace.tsx`: `undoEdit()` — bước cuối là mốc → `undoKind.mutate(batchId)` (đúng mutation của nút toast: skip mode, cùng toast/message), không thì `store.undo()`. Dùng cho phím Cmd+Z và nút Hoàn tác trên topbar. Đang pending thì bỏ phím. Nút toast cũng đi `afterBatchUndo` nên mốc bị tiêu thụ (Cmd+Z không hoàn tác lần 2). `onMutate` chỉ ẩn toast của đúng lượt.
- Sau hoàn tác thành công, trang đang mở: (a) được khôi phục → `carry` giữ lịch sử trước mốc, nạp lại đúng nội dung trước lượt (so `same`) thì đặt lại → Cmd+Z tiếp lùi các sửa trước lượt; (b) server bỏ qua vì version đã tăng (sửa rồi Cmd+Z sửa đó: autosave vẫn PUT → version +1) mà nội dung vẫn bằng state sau lượt → tự đưa về `before` tại chỗ (như 1 bước undo, lưu qua autosave; message tính +1 trang); (c) bỏ qua vì còn sửa khác → giữ nguyên, chỉ giữ các bước sau mốc.

## Quyết định
- Đổi trang: lịch sử vẫn theo từng trang (stash sẵn có). Mốc nằm ở lịch sử trang đang mở lúc áp; sang trang khác Cmd+Z không thấy mốc (toast vẫn dùng được), quay lại (version không đổi) còn mốc. Hoàn tác từ trang khác dọn mốc trong stash.
- Redo: KHÔNG làm (server không có "áp lại"). Mốc xoá nhánh redo khi cắm và khi hoàn tác; mốc không bao giờ nằm trong `future`.
- Lỗi hoàn tác: mạng/423/5xx → lịch sử và mốc nguyên (toast báo lỗi như cũ); 404/409 (lượt không còn) → bỏ mốc + lịch sử trước lượt để Cmd+Z không kẹt.

## File
apps/web: `editor/history.ts`, `editor/store.ts`, `editor/use-chapter-session.ts`, `chapter/chapter-workspace.tsx`, `chapter/chapter-topbar.tsx`, tests `__tests__/history.test.ts`, `__tests__/chapter-session.test.ts`, `e2e/editor.spec.ts`; `docs/editor.md` (1 câu).

## Bằng chứng test
- Unit: web 280 pass. Đỏ khi bỏ sửa: bỏ giữ lịch sử → 3 test đỏ (editMany past, "undoing keeps earlier history", "edit then Cmd+Z … restored in place"); bỏ tự khôi phục tại chỗ → test đó đỏ; đặt `carry` sau `setCached` → test "cache update reloads the open page by itself" đỏ (lỗi thật gặp ở e2e: lịch sử mất vì subscription nạp lại trước).
- E2E (editor + chapter-tools + full-flow): 21/21 xanh, gồm 2 test mới: Cmd+Z sau Áp kiểu → khôi phục mọi trang, Cmd+Z tiếp → cỡ chữ về 22; sửa → Cmd+Z → Cmd+Z → hoàn tác cả lượt, toast biến mất.
- `pnpm typecheck`, `pnpm lint` sạch.

## Bổ sung: Tìm/Thay + Áp glossary (commit riêng)
- API (tương thích ngược): `applyBatch` trả thêm `versions` (version mới của từng page đã ghi) → `find-replace/apply` và `glossary-apply/apply` có `versions`; test `apps/api/test/find-replace.test.ts` kiểm. Docs `export-and-batch-edit.md`.
- Client: `ChapterSession.recordServerBatch(batchId, versions)` (gọi trước khi tải lại state): page đang mở có trong `versions` → `carry` khớp theo version mới, mốc cắm lúc nạp lại (biết state sau lượt); không có → mốc "không đụng trang này"; server cũ (không `versions`) hoặc đang có sửa chưa lưu → không cắm. Cmd+Z dùng đúng `undoKind` (skip + tự khôi phục tại chỗ), thông báo nêu đúng loại lượt ("thay thế" / "áp glossary" / mặc định "áp kiểu" — `undoStyleText(..., what)`).
- Panel: `BatchHooks {applied, undone, lastUndone}` truyền qua `ToolPanelProps`; nút Hoàn tác của panel (chế độ fail như cũ) gọi `afterBatchUndo` nên mốc bị tiêu thụ; Cmd+Z hoàn tác → `lastUndone` làm panel bỏ trạng thái "đã áp dụng" (không còn nút treo → "không còn để hoàn tác").
- Cmd+Z trong ô nhập: `resolveKey` đã trả null khi `inField` (thêm unit test; e2e xác nhận ô Tìm giữ undo gốc).
- Redo: vẫn không hỗ trợ.
- Test: unit `recordServerBatch` (4, đỏ 3 khi vô hiệu hoá), `undoStyleText` nhãn, shortcuts inField; e2e `chapter-tools` "Cmd+Z hoàn tác cả lượt…" (đỏ khi bỏ `recordServerBatch`). Glossary dùng chung `useBatchFlow` + cùng hook, kiểm ở mức unit/lõi chung.

## Mở
- Mốc cũ hơn (nhiều lượt liên tiếp ở các trang khác nhau) hoạt động theo thứ tự lịch sử từng trang.
- Cửa sổ rất ngắn giữa lúc server áp xong và lúc trang đang mở nạp lại: Cmd+Z trong khoảng đó chưa có mốc.

## Review fixes (code-review-261031-bulk-undo-shortcut-report.md)
1. Hai lượt liên tiếp (Med-High): `undoBatch` (api) coi page "đã sửa tiếp" theo NỘI DUNG — version khác nhưng nội dung hiện tại bằng nội dung lượt đã ghi (history row ở version h.version+1) vẫn khôi phục (cả skip lẫn fail). Test API: áp A, áp B cùng page, lưu lại đúng nội dung, undo B rồi undo A (skip) → mọi page về nguyên bản (đỏ khi bỏ sửa). Hai test cũ lưu lại y nguyên làm "sửa" được đổi thành sửa thật (find-replace, series-ignore-apply). Unit: "two bulk edits in a row undo one after the other".
2. Lỗi tạm: chỉ 404 bỏ mốc + lịch sử trước lượt; 409 `chapter_busy`/`undo_conflict`, 423, mạng, 5xx giữ mốc; nút Hoàn tác của panel vẫn còn (panel chỉ tắt khi thành công hoặc 404).
3. Khoá hoàn tác chung `undoBusy` (toast, Cmd+Z, nút panel qua `BatchHooks.begin/end`); `afterBatchUndo(batchId, skipped, restored)` chỉ khôi phục tại chỗ khi `restored > 0`.
4. `recordServerBatch` chỉ cắm khi `versions[page] === baseVersion + 1` (không thì như cũ: lịch sử bỏ khi nạp lại).
5. Sửa trong lúc yêu cầu hoàn tác còn bay: để nguyên, ghi chú trong code — trang nạp lại bản khôi phục, sửa đó rebase qua 409 nên không mất dữ liệu nhưng không undo được (giữ lịch sử sau mốc cũng vô ích vì rebase xoá lịch sử).
6. Test: server giả trong `chapter-session.test.ts` giờ theo nội dung/version, nhiều lượt (`batch-N`), có `forceSkip` (bản ghi lịch sử bị dọn); e2e `chapter-tools` đợi 1,5s và khẳng định không có request `find-replace/undo`. Đỏ khi bỏ `restored > 0` hoặc guard `baseVersion + 1`.

## Review fixes round 2 (Re-review 65d3b50)
1. Perf: `undoBatch` chỉ lấy đúng các bản ghi `(page_id IN …, version IN h.version+1)` (dùng index `page_state_history_page_idx`) rồi tra `Map` — không đọc cả lịch sử (tới 50 state/page), không còn `find` O(H×W).
2. Cổng `restored > 0`: đổi thành `restored > 0 || skipped.length === 1`. Lý do chọn: chỉ bỏ cổng thì lượt nhiều trang bị bỏ qua hết (đã hoàn tác ở nơi khác) cũng bị ghi đè tại chỗ; giữ cổng hẹp thì vẫn chặn trường hợp đó nhưng cho lượt chỉ có đúng trang đang mở (bản ghi lịch sử bị dọn → server trả pages 0) được khôi phục. Race hoàn tác kép đã bị khoá chung `undoBusy` chặn. Test hiện lại ca một trang (`["A"]`, đỏ khi để cổng cũ); ca `["A","B"]` bỏ qua hết giữ nguyên "không đụng".
3. Toast Hoàn tác của Áp kiểu trả lại cho mọi lỗi trừ 404 (Áp kiểu không có nút khác); sửa comment cũ.
4. Panel: `BatchHooks.busy` (state `undoing` phản ánh khoá chung) OR vào `flow.busy` → nút Hoàn tác (và Áp dụng/Xem trước) tắt khi đang có yêu cầu hoàn tác của toast / Cmd+Z / panel.
5. Test API: ca hai lượt liên tiếp dùng `newChapter` + khoá riêng, không phụ thuộc thứ tự; `afterA` đổi thành `afterB`; kiểm `pages: 3, skipped: []` cho cả hai lần undo.
Kiểm c8f0791 (restyle no-op không ghi gì): `editMany` đã bỏ page `next === cur.state`, không ảnh hưởng mốc; e2e editor xanh.
