# Code review — b645fbe, 3350822, e3c3642, 4e68761, 32d24e6

Chỉ báo cáo, không sửa code. Kiểm chứng:
- `vitest` web: rebase / number-input / chapter-session đều qua (30/30).
- `pnpm --filter @mtl/api test`: 313/313 qua (filter không lọc, nên chạy cả suite).
- `tsc -p apps/web`: sạch.
- Chạy một probe node với `rebase.ts` thật.

Không chạy e2e Playwright.

## Kết luận

Không có lỗi chặn merge. Có 1 lỗi Medium còn sót trong rebase (đã tái hiện), và vài lỗi Low về UX hoặc race.

## Findings

### M1. Conflict giả chỉ có field `lines`, và "Khôi phục bản của tôi" không làm gì (CONFIRMED)
`apps/web/src/features/editor/rebase.ts:126-131`. Vòng clash vẫn coi `lines` là field thường, dù sau đó `syncLines` mới suy ra `lines`.

Kịch bản:
- Base đã có `lines` (box đã typeset, `lines: [text]`).
- Local: `setStyle(font_size 40)` chạy relayout, `lines` thành L.
- Server: Tìm/Thay đổi `text` và đặt `lines: []` (find-replace.ts:105).

Probe cho kết quả:
- Box gộp đúng: text server, font 40, `lines: []`.
- Nhưng `conflicts = [["text_boxes:t1", ["lines"]]]`. ConflictList hiện "· lines".
- Bấm khôi phục thì `restoreConflict` gán L, rồi `syncLines(cur, local, before)` thấy `cur` trùng `before` ở mọi đầu vào nên trả lại `[]`. Kết quả: không đổi gì.

Test mới `drops stale lines when my style change meets the server's text change` dùng base `unlaid` (`lines: []`) nên không bắt được ca này.

Đây không phải regression: trước commit, cũng conflict này nhưng khôi phục còn tệ hơn (vẽ L với text của server).

Gợi ý:
- Với `text_boxes`, bỏ `lines` khỏi vòng clash vì nó là field suy ra.
- Hoặc lọc `lines` khỏi `clashed` trước khi push conflict.
- Thêm test với base đã layout.

### L1. Bấm "Hoàn tác" 2 lần thì thông báo thất bại sai đè lên thông báo thành công (PLAUSIBLE)
`chapter-workspace.tsx:543` và `:497-500`. Nút không bị tắt khi `undoKind.isPending`. Toast chỉ bị gỡ ở `onSuccess`, nên toast vẫn còn trong suốt lúc `saver.flush()` và request đang chạy.

Lần bấm thứ hai có thể ra 2 kết quả:
- Nếu chạy sau lần đầu: mọi trang có version ≠ h.version+1, nên `skipped` gồm tất cả. Toast hiện "Không hoàn tác được: trang 1, 2 đã sửa sau khi áp kiểu." Câu này sai, vì chính lượt hoàn tác vừa rồi đã đổi version.
- Nếu chạy song song: UPDATE theo version chờ khoá rồi khớp 0 dòng, trả 409 `undo_conflict` (thông báo danger).

Lỗi double-submit đã có từ trước, nhưng câu thông báo giờ gây hiểu nhầm hơn.

Gợi ý: `onMutate: () => setStyleUndo(null)` (và khôi phục lại ở `onError`), hoặc tắt nút khi đang chạy.

### L2. Trường hợp bỏ qua hết trang dùng tone "info" nên tự ẩn (CONFIRMED, UX)
`chapter-workspace.tsx:124` và `:500`. Khi `restored = 0` và mọi trang bị bỏ qua, thông báo là một thất bại nhưng vẫn dùng `tone: "info"`, nên tự ẩn sau NOTICE_MS. Toast hoàn tác cũng đã bị gỡ, nên người dùng dễ bỏ lỡ.

Gợi ý: dùng `warn` khi `restored === 0`.

### L3. Đường `refreshAi` vẫn nạp lại mà không giữ khối đang chọn (PLAUSIBLE)
`use-chapter-session.ts:161`: `s.load({ pageId, ...d })` không truyền `selection`. Khi cùng trang mà server lên version giữa lúc `syncActive` và lúc fetch trong `refreshAi` (ví dụ một lượt ghi khác vừa xong), selection bị xoá. Panel công cụ lại mở ra, đúng lỗi mà 4e68761 vừa sửa ở `syncActive`. Hiếm gặp.

Gợi ý: dùng chung logic `keep` cho cả hai chỗ.

### L4. Undo trả 404 `batch_not_found` hoặc lỗi vĩnh viễn thì toast thành nút chết (CONFIRMED, UX nhỏ)
`chapter-workspace.tsx` onError. `styleUndo` được giữ lại khi lỗi; điều này đúng với 423/409 `chapter_busy` vì người dùng có thể thử lại. Nhưng với 404 (history đã prune hết), bấm lại lần nào cũng lỗi. Người dùng vẫn có nút Đóng nên chấp nhận được.

### Ghi chú, không cần sửa ngay
- `syncLines` (`rebase.ts:89`) ưu tiên `lines` của local khi cả hai bên trùng mọi đầu vào. Nếu server chỉ đổi `lines` với cùng đầu vào (typeset lại), `lines` cũ của local sẽ đè lên. Hiện chưa thấy đường nào ở server làm vậy, vì Tìm/Thay, glossary và AI đều đổi `text`.
- `commitMin`: dùng phím mũi tên hoặc spinner xuống 0 thì chưa xem trước được việc xoá viền cho tới khi rời ô hoặc nhấn Enter. Chấp nhận được.

## Đã kiểm, không có lỗi
- **LINE_INPUTS** khớp đủ đầu vào của `layoutBox`/`ensure_lines`: text, w, h, font_family, font_size, line_height, pad, auto_fit. `letter_spacing` là thừa nhưng vô hại (editor không sửa được field này, worker bỏ qua). Khi `lines: []`, canvas (`TextBoxNode.tsx:28`) và export (`render.py:249`, theo `auto_fit`) đều ngắt dòng lại, nên xoá `lines` là an toàn.
- **`JSON.parse(JSON.stringify(draft))` trong `restoreConflict`**: chạy đúng trên draft immer. Test khôi phục text cho ra đúng box local.
- **styleUndo**:
  - `ChapterWorkspace` có `key={chapterId}` (router.tsx:91), nên state reset khi đổi chương.
  - Lượt áp mới thay toast cũ. Kết quả "đã cùng kiểu" thì giữ toast cũ.
  - Lỗi khi áp hoặc hoàn tác vẫn giữ toast.
  - Hai slot render riêng, không bị render trùng. Role status/alert giống cách cũ.
- **number-input**: Enter và blur vẫn commit 0, nên viền bị xoá (`committedNumber` ra 0 ≠ value thì gọi `onValue(0)`). Các NumberInput khác không truyền `commitMin` nên không bị ảnh hưởng.
- **`load(selection)`**:
  - Chỉ `syncActive` truyền selection, sau khi đã kiểm id còn trong `c.state` và cùng `s.pageId`.
  - `select` cũ chỉ là `set({selection})`, nên không mất side effect nào.
  - Đường `activate` (đổi trang) không truyền selection, nên vẫn reset như trước.
- **undo skip**:
  - Có tenant isolation: `sdb` scoped, `byId(chapters)`, và `chapterBatchHistory` lọc theo page của chương.
  - `conflicts` được validate bằng zod enum, mặc định `"fail"`; giá trị sai trả 400 (có test).
  - Response chỉ thêm field `skipped`; FindReplace/Glossary chỉ đọc `pages` và vẫn gửi mode `"fail"`.
  - Đổi id trang sang số trang qua `ord + 1` trên `progress.pages` (gồm cả trang ẩn), khớp với page-rail.
  - Trang active được nạp lại qua `data.refresh`, rồi `setStates`, rồi cache đổi, rồi `syncActive` (nếu chưa có sửa).
