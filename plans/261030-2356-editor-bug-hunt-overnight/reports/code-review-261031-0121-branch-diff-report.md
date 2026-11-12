# Code review — `git diff main..fix/editor-bug-hunt` (8 commit)

Chế độ: report only (không sửa code, không commit). Phạm vi: 23 file, +545/−160.

## Kiểm chứng đã chạy

| Lệnh | Kết quả |
|---|---|
| `vitest run` web: `chapter-session.test.ts`, `number-input.test.ts`, `rows.test.ts` | 28/28 pass |
| `vitest run` api: `page-state`, `find-replace`, `series-ignore-apply`, `tenant-isolation` | 60/60 pass |
| `pytest tests/test_handlers_cover_job_types.py` | 3/3 pass |
| `pnpm typecheck`, `pnpm lint` | exit 0 |
| E2E Playwright | không chạy (theo yêu cầu) |

## Spec compliance

Cả 6 mục ý định (batch PUT + `editMany`, NumberInput, `sameKindBoxIds`, re-apply → 409, worker kebab-case, giữ selection)
đều có trong diff và có test. Không thấy thay đổi ngoài phạm vi.

## Findings (xếp theo mức độ)

### M1 — Medium · CONFIRMED — Hoàn tác "Áp kiểu" mất khi có bất kỳ thông báo nào khác
- `apps/web/src/features/chapter/chapter-workspace.tsx:371-374` (`notify` = `setNotice(n)`, chỉ có **1 ô** thông báo) +
  `:520-526` (toast sticky là chỗ duy nhất có "Hoàn tác").
- Tình huống: Áp kiểu cho 30 khối / 10 trang → toast "Hoàn tác" → người dùng bấm "Dịch lại khối", ẩn trang, gặp lỗi lưu,
  hay bất cứ `notify(...)` nào khác (16 chỗ gọi) → toast bị thay → không còn đường hoàn tác nào trên UI (Cmd+Z không lùi
  lượt này, lịch sử undo trang đang mở đã bị xoá). Bước xác nhận cũ đã bỏ với lý do "hoàn tác được", nên lưới an toàn
  thực tế yếu hơn trước. (Tìm/Thay không bị vì nút Hoàn tác nằm trong panel, giữ `applied`.)
- Gợi ý: giữ `batch_id` lượt áp kiểu gần nhất trong state riêng (nút "Hoàn tác áp kiểu" ở panel Chọn/nâng cao), hoặc
  không cho notify khác ghi đè notice có action hoàn tác.

### M2 — Medium/Low · CONFIRMED — Hoàn tác thất bại cả lượt sau bất kỳ sửa nào trên trang thuộc batch
- `apps/api/src/routes/find-replace.ts:182` (`undoBatch(..., "fail")`), dùng cho toast áp kiểu
  (`chapter-workspace.tsx:476-490`).
- `editMany` gần như luôn đưa **trang đang mở** vào batch (trang nguồn thường có khối cùng loại khác). Áp kiểu → chỉnh
  1 khối trên trang đang mở (autosave +1 version) → bấm "Hoàn tác" → 409 `undo_conflict` cho **mọi** trang, dù toast
  sticky vẫn mời bấm. Nhất quán với Tìm/Thay, nhưng ở đây trang đang mở luôn bị cuốn vào nên dễ gặp hơn nhiều.
- Gợi ý: cân nhắc chế độ `"skip"` (như series-ignore) + báo trang bị bỏ qua, hoặc ẩn nút khi trang đang mở bị sửa tiếp.

### L1 — Low · CONFIRMED — Áp kiểu bị chặn cả chương khi chương "processing"; nhánh bỏ qua trang bận phía client gần như chết
- `apps/api/src/routes/page-state.ts:208` `assertChapterIdle(ch)` vs `apps/web/src/features/editor/use-chapter-session.ts:304`
  `if (this.busy.has(p.id)) continue`.
- Trang bận (`translating`/`translate_queued`/`pending`/`preparing`) chỉ xuất hiện khi chương `processing`
  (`jobs/enqueue.ts:301,490`, `translate-chain.ts:328`) → server luôn trả `chapter_busy` trước khi xét page. Hồi quy so với
  `updateOther` cũ (vẫn ghi các trang rảnh khi đang "Dịch lại trang này" 1 trang). Nút vẫn bật → bấm mới nhận toast lỗi.
  Unit test "bỏ qua page bận" kiểm một đường production không tới được. Doc có ghi `chapter_busy` nên có vẻ cố ý — cần
  chốt: hoặc bỏ `assertChapterIdle` (dựa vào `isPageBusy` từng trang như PUT đơn), hoặc tắt nút khi chương chưa ổn định.

### L2 — Low · CONFIRMED (có từ trước, nằm đúng chỗ branch sửa) — Gõ "0.5" vào Viền ngoài làm mất màu viền
- `apps/web/src/features/editor/panels/Properties.tsx:223-225` + `panels/number-input.ts:7-11`.
- Viền đen 2px, chọn hết ô, gõ "0.5": phím "0" nằm trong `[0,20]` → `liveNumber` áp 0 → `stroke = null`; "0.5" → tạo lại
  stroke với `box.stroke?.color ?? "#ffffff"` = **trắng**. Đúng loại lỗi "giá trị gõ dở bị áp" mà commit `b8daf73` nhắm tới.
- Gợi ý: với stroke, không áp 0 khi đang gõ (chỉ khi commit), hoặc nhớ màu cũ khi width về 0.

### L3 — Low · PLAUSIBLE — Một trang lệch là hỏng cả lượt, thông báo chung chung
- `chapter-workspace.tsx:530-540`. Cache trang khác cũ (AI vừa xong, progress debounce 1s) → 409 `version_conflict` cả
  batch (trước đây retry từng trang 1 lần). Trang vừa ẩn / vừa vào bận trước khi progress cập nhật → 409 `page_skipped` /
  `page_busy` → rơi vào `errorMessage(e)` thô. Không mất dữ liệu (transaction rollback), chỉ UX.

### L4 — Low · PLAUSIBLE — Giữ selection trong `syncActive` phát 2 lần set (null → id)
- `use-chapter-session.ts:177-181`: `s.load()` (selection null) rồi `select(id)`. Subscriber
  `chapter-workspace.tsx:302-313` thấy null→id như một lần chọn mới → nếu panel đang đóng (`panelRef.current === null`)
  sẽ **tự mở panel "tool"** khi AI/Tìm-Thay nạp bản mới cho trang đang mở. Gợi ý: truyền selection vào `load` (1 lần set).
  Ngoài ra id box do AI đặt lại (`tb-r1`…) có thể trỏ sang khối khác sau khi dịch lại — chấp nhận được.

### Nit
- Số "N khối" trong toast đếm cả khối đã cùng kiểu (`counts` lấy `ids.length`, không phải số khối thực đổi) — có từ trước.
- `NumberInput key={box.id}`: id lặp giữa các trang nên đổi sang khối cùng id ở trang khác không remount; thực tế vô hại
  vì blur commit trước khi đổi chọn.
- Payload `PUT /chapters/:id/states` gửi full state mọi trang (≤1000); không có body limit ở Hono, nhưng proxy phía trước
  có thể chặn với chương rất dài.

## Đã kiểm, không phải lỗi
- **Tenant isolation**: `sdb` scoped theo user; pages lọc `chapterId = ch.id` + `inArray`; test tenant-isolation đã thêm.
- **Atomicity / version**: kiểm version trong tx + `WHERE version = p.version` trong UPDATE; HTTPException trong tx →
  rollback, không ghi nửa chừng. Thứ tự UPDATE theo `ord` (client duyệt `pages` theo ord) giống `applyBatch` → không
  thấy nguy cơ deadlock giữa hai đường.
- **Khoá 423, trùng page (400), page chương khác (404), ẩn (409), sai kích thước (400), danh sách rỗng** (zod `.min(1)`;
  client trả null trước khi gọi).
- **Undo tương thích**: history ghi `version = p.version` + `batchId`, `undoBatch` kiểm `version + 1` → đúng; batch không
  gắn tag nên `find-replace/undo` nhận được, `series-ignore` undo (đòi tag) không nhận nhầm.
- **Race autosave ↔ editMany**: `saver.flush()` + kiểm `doc === base` trước; sửa xen giữa lúc PUT bay → hoặc batch 409
  (cả lượt không ghi) hoặc Saver 409 → rebase lên bản đã áp kiểu. Không mất dữ liệu.
- **`applyBatch` stale mới**: `rows` chỉ gồm trang chương hiện tại (không ẩn) nên `versions` gộp cả series
  (series-ignore) không gây stale giả; hành vi "trang đã xem đổi version → chương bị bỏ qua" khớp doc series-ignore.
- **Worker**: `inputs_schema()` + test kiểm mọi handler có file schema.
- `useMemo` session thêm `chapterId`: `ChapterWorkspace` đã `key={chapterId}` (router.tsx:91) → không tạo lại giữa chừng.

## Câu hỏi mở
1. `chapter_busy` cho Áp kiểu là cố ý? Nếu có, nên tắt nút khi chương chưa ổn định và bỏ nhánh busy-skip ở client.
2. Muốn hoàn tác Áp kiểu ở chế độ "fail" (như Tìm/Thay) hay "skip"?
