# Báo cáo bug hunt editor (đêm 30→31/10/2026)

Branch: `fix/editor-bug-hunt` (chưa push/merge). Môi trường: dev `localhost:5180` (API 8787, worker Python thật + Gemini) và
e2e Playwright (5181, worker giả).

Dữ liệu thử: series **"QA đêm"** (`01a18df3-d212-70fa-82a5-b7a51a11ca31`) + chương 1 (`01a18df3-d21d-7100-9a4d-d0ddd106b526`),
4 trang ảnh tổng hợp (bóng thoại chữ Hàn, tạo bằng PIL — không chép ảnh của chương thật), dịch bằng worker thật. Glossary
series có 1 mục `라면 → mì gói` để thử Áp glossary. Chương thật `01a18dab-…` chỉ mở xem 1 lần (tab của user đang giữ khoá →
editor ở chế độ chỉ xem, không ghi gì).


## Tóm tắt cho sáng mai (31/10, 02:50)

Branch `fix/editor-bug-hunt` (chưa push/merge), 24 commit trên `main`. **Gate xanh**: `pnpm typecheck` ✓ · `pnpm lint` ✓ ·
`pnpm test` ✓ **3 lượt liên tiếp** (shared 37, web 266, db 5, api 313) · worker pytest 264 ✓ · **e2e toàn bộ 40/40** ✓.

Commit phiên 31/10 (sau `3d3d53e` của đêm 30):
- `b645fbe` rebase sau xung đột giữ `lines` khớp `text` (#11) · `4d16a74` `lines` không còn là xung đột riêng (#18)
- `3350822` toast Hoàn tác Áp kiểu không bị đè (#12) · `cd9e30c` nút Hoàn tác ẩn khi đang chạy (#19)
- `32d24e6` Hoàn tác Áp kiểu bỏ qua trang đã sửa (#15) · `a797c41` nói rõ trang đang mở giữ nguyên (#21)
- `e3c3642` gõ viền 0.5 không mất màu (#13) · `4e68761`, `b0612fa` nạp lại trang (syncActive, refreshAi) giữ khối chọn (#14, #20)
- `0b0e01c` OCR chờ job thử lại: báo lỗi lần thử + nút "Huỷ OCR" (#9) · `f990690` Huỷ không áp kết quả trễ, huỷ job server
  khi huỷ sớm / rời trang · `07ec87b` ghi chú thử lại theo loại lỗi (#22) · `d357aeb` e2e rời chương huỷ job
- `40eb9d9` tách `undoStyleText` (Fast Refresh) · `6b5f2ef` 4 e2e trang series theo modal (#10)
- `fc933b2` test API chập chờn: thứ tự claim job trùng `created_at` → test hoàn tất prepare theo thứ tự trang (#23)

Đã xác nhận trên dev: khoá/chỉ xem + xung đột 2 tab; "Dịch lại khối" + OCR vùng end-to-end (#5); khối 1 trang 1 chương QA
đã gõ lại. #16 giữ nguyên theo đề xuất.

**Còn mở**: #8 căn giữa dọc (cần user) · so với Torii (không làm) · thấp: nhiều OCR cùng trang dùng chung 1 dòng "thử lại"
(có thể nháy) · `role="status"` bọc nút Huỷ OCR (a11y nhỏ) · hàng đợi claim job trùng `created_at` theo thứ tự bất kỳ →
trang 1 có thể prepare sau cùng, lượt dịch đầu chậm hơn (sản phẩm, ngoài editor — đề xuất thêm tie-break theo thứ tự trang).

**Câu hỏi cho user**: 1 (Cmd+Z cho lượt hàng loạt), 2 (căn giữa dọc #8), 3 (cuộn sang trang kế), 5 (giữ/xoá series "QA đêm"),
8 (thêm tie-break thứ tự trang cho hàng đợi?) — chi tiết cuối report.

## Kết quả

| # | Bug | Trạng thái | Commit |
|---|---|---|---|
| 1 | "Áp kiểu" ghi thẳng trang khác, không hoàn tác được, có thể dừng nửa chừng | fixed | `fc1fd7d` |
| 2 | Ô số panel kiểu chữ kẹp từng phím: gõ "24" ra 64, xoá trắng nhảy về min | fixed | `b8daf73` |
| 3 | "Áp kiểu" bỏ sót khối ở trang khác trùng id với khối nguồn (id box lặp mỗi trang) | fixed | `04f2a9b` |
| 4 | Tìm/Thay, Glossary: bấm "Áp dụng" lần 2 → batch rỗng, mất "Hoàn tác" của lần thật | fixed | `ff4ef85` |
| 5 | Worker thật: mọi job `page.ocr_region` (OCR vùng R, "Dịch lại khối") hỏng "thiếu JSON Schema" | fixed, xác nhận end-to-end trên dev 31/10 01:27 | `bbf5a45` |
| 6 | Sau Áp kiểu / Tìm-Thay / AI ghi trang đang mở: khối đang chọn bị bỏ chọn | fixed | `3d3d53e` |
| 7 | E2E `chapter-tools`, `full-flow` hỏng sẵn sau đổi nhãn "Xuất" → "Export" | fixed (test) | `747d90c` |
| 8 | Chữ không căn giữa dọc trong khung sau khi sửa ngắn lại | open — cần user | — |
| 9 | OCR vùng lỗi nội bộ: UI "Đang OCR…" vài phút không báo gì, không huỷ được | fixed | `0b0e01c`, `f990690` |
| 10 | E2E trang series (`routes`, `glossary-language-pair`, `series-manage` ×2) hỏng sẵn | fixed (test, theo luồng modal) | `6b5f2ef` |
| 11 | Xung đột phiên bản: rebase ghép `text` của server với `lines` của mình → canvas/export vẽ chữ khác bản dịch | fixed | `b645fbe` |
| 12 | Toast "Hoàn tác" của Áp kiểu bị thông báo khác thay mất → không còn cách hoàn tác lượt đó | fixed | `3350822` |
| 13 | Gõ "0.5" vào ô Viền ngoài: "0" áp ngay → xoá viền → viền tạo lại màu trắng, mất màu cũ | fixed | `e3c3642` |
| 14 | Nạp bản mới của trang đang mở: chọn null rồi chọn lại → panel công cụ tự bật dù người dùng đã đóng | fixed | `4e68761` |
| 15 | Hoàn tác Áp kiểu hỏng toàn bộ (409 `undo_conflict`) nếu sửa thêm 1 khối sau khi áp | fixed (chế độ "skip", theo đề xuất) | `32d24e6` |
| 16 | Áp kiểu bị chặn cả chương khi chương đang xử lý (kể cả dịch lại 1 trang) | giữ nguyên theo đề xuất (user uỷ quyền 31/10) | — |
| 17 | 1 trang lệch version → cả lượt Áp kiểu 409 (trước đây thử lại từng trang) | chấp nhận (thiết kế nguyên tử) | — |
| 18 | Xung đột chỉ ở `lines` vẫn hiện "· lines", "Khôi phục bản của tôi" không đổi gì | fixed | `4d16a74` |
| 19 | Bấm đúp "Hoàn tác" Áp kiểu → lần 2 báo sai "Không hoàn tác được"; báo "không hoàn tác được trang nào" tự ẩn; lỗi vĩnh viễn vẫn để nút | fixed | `cd9e30c` |
| 20 | Đường nạp `refreshAi` vẫn nạp lại không giữ khối đang chọn (panel có thể tự bật) | fixed | `b0612fa` |
| 21 | Hoàn tác Áp kiểu bỏ qua đúng trang đang mở: thông báo chỉ nói "bỏ qua trang 1" → tưởng nút hỏng | fixed | `a797c41` |
| 22 | Review bản sửa #9: Huỷ lúc đang poll vẫn áp kết quả; Huỷ trước khi có job id / rời trang → job server vẫn chạy; Huỷ trễ ~1.5s; ghi chú thử lại in lỗi thô | fixed | `f990690`, `07ec87b`, `d357aeb` |
| 23 | Test API chập chờn `ai-write-rules` "PUT on a finished page…" | fixed (test) | `fc933b2` |

Gate cuối (31/10 01:40, sau #11–#14): `pnpm typecheck` ✓ · `pnpm lint` ✓ · `pnpm test` ✓ (shared 37, web 252, db 5, api 312)
· worker `pytest` 264 ✓ · e2e `editor` + `chapter-tools` + `full-flow` 16/16 ✓. Gate đêm trước:
e2e Playwright: 33 passed, 4 failed — cả 4 là #10 (trang series, hỏng sẵn từ `e76956b`); mọi spec editor / chương
(`editor`, `chapter-tools`, `full-flow`, `proofread`, `fonts`, `typeset-parity`…) xanh. Docs: `docs/editor.md`,
`docs/export-and-batch-edit.md` (`7b0fb88`).

### 1. "Áp kiểu cho khối cùng loại" không hoàn tác được (lỗi đã biết)
- **Tái hiện**: chọn khối → Kiểu chữ nâng cao → "Áp kiểu này cho khối thoại trong chương" → Cmd+Z chỉ hoàn tác trang đang
  mở; trang khác đã PUT thẳng (`ChapterSession.updateOther`), không có cách lùi. Lỗi giữa chừng → vài trang đã áp, vài
  trang chưa.
- **Nguyên nhân**: mỗi trang khác ghi 1 PUT riêng, không có `batch_id`, ngoài lịch sử undo của editor.
- **Sửa**: API mới `PUT /chapters/:id/states {pages:[{page_id, version, state}]}` ghi mọi trang trong 1 transaction, chung
  `batch_id` (khoá 423, `chapter_busy`, page ẩn/bận/khác chương/sai kích thước bị từ chối, version lệch → 409
  `version_conflict` không ghi trang nào). Client `ChapterSession.editMany` lưu trang đang sửa, tính state mới bằng layout
  trình duyệt (giữ đúng ngắt dòng) cho **mọi** trang kể cả trang đang mở, gửi 1 lượt; toast "Đã áp kiểu cho N khối trên M
  trang · Hoàn tác" gọi `find-replace/undo` sẵn có. Bỏ bước xác nhận (lý do của nó là "không hoàn tác được").
- **Test**: API `page-state.test.ts` (batch + undo, stale, 423/409/404/400), tenant isolation, unit `chapter-session.test.ts`
  (`editMany`), e2e `editor.spec.ts` "apply style … Hoàn tác restores all pages".
- **Đánh đổi**: Cmd+Z không hoàn tác lượt này (lịch sử undo của trang đang mở bị bỏ khi nạp bản mới, giống Tìm/Thay) — chỉ
  nút "Hoàn tác" ở toast (toast không tự ẩn). Xem câu hỏi 1.

### 2. Ô số kẹp ngay mỗi phím gõ
- **Tái hiện**: panel Chọn, bỏ "Tự khớp", chọn hết ô Cỡ chữ (33), gõ "24" → **64**. Xoá trắng ô → nhảy 6.
- **Nguyên nhân**: `onChange` của ô số (`Properties.tsx`) kẹp `[min,max]` từng phím: "2" < 6 → 6, rồi thêm "4" → "64".
  Cùng lỗi ở Giãn dòng, Lề, Viền ngoài.
- **Sửa**: `NumberInput` giữ chuỗi đang gõ; chỉ áp số hợp lệ trong khoảng khi gõ, rời ô/Enter mới kẹp (rỗng → giữ giá trị
  cũ). Hàm thuần `panels/number-input.ts`.
- **Test**: unit `number-input.test.ts`; e2e gõ từng phím "18" vào ô Cỡ chữ.

### 3. Áp kiểu bỏ sót khối trùng id ở trang khác
- **Tái hiện** (thấy ngay trên dev sau sửa #1): 12 khối thoại / 4 trang, áp từ 1 khối → báo **8 khối** thay vì 11; khối
  `tb-r3` ở 3 trang khác không đổi.
- **Nguyên nhân**: id box chỉ duy nhất trong 1 trang (AI đặt `tb-r1`, `tb-r3`… ở mọi trang); `sameKindBoxIds(st, kind,
  src.id)` loại id khối nguồn ở **mọi** trang. Lỗi có từ trước sửa #1.
- **Sửa**: chỉ loại khối nguồn ở chính trang nguồn (`exceptId` null cho trang khác).
- **Test**: unit `rows.test.ts`; e2e dùng id trùng giữa 2 trang.

### 4. "Áp dụng" lần 2 làm mất "Hoàn tác"
- **Tái hiện**: Tìm "không" → Thay "hông" → Xem trước → Áp dụng ("Đã thay 4 chỗ trên 2 trang") → bấm Áp dụng lần nữa →
  "Đã thay 0 chỗ trên 0 trang", bấm Hoàn tác → "Lần áp dụng này không còn để hoàn tác".
- **Nguyên nhân**: `applyBatch` chỉ kiểm version của trang **còn khớp**; lần 2 không trang nào khớp → không stale → ghi
  batch rỗng, client thay `applied` (batch thật) bằng batch rỗng.
- **Sửa**: server coi trang có trong `versions` mà version đã đổi là stale (409 `preview_stale`, lọc theo trang của chương
  nên áp theo series vẫn đúng); UI tắt "Áp dụng" sau khi áp tới lần Xem trước kế. Ảnh hưởng cả Áp glossary và ẩn chữ bỏ
  qua theo series (dùng chung lõi).
- **Test**: API `find-replace.test.ts` "applying the same preview again → 409"; e2e `chapter-tools` nút Áp dụng tắt sau áp.

### 5. Worker thật không chạy được OCR vùng / Dịch lại khối
- **Tái hiện**: chọn khối → "Dịch lại khối" → nút "Đang OCR…" mãi; job `page.ocr_region` lỗi `hợp đồng: thiếu JSON Schema
  …/inputs-page-ocr_region.schema.json`, requeue tới hết `max_attempts`.
- **Nguyên nhân**: `runner.py` đổi `.` → `-` nhưng không đổi `_`, còn file emit là `inputs-page-ocr-region.schema.json`.
  E2E không bắt được vì worker giả không validate schema.
- **Sửa**: `inputs_schema()` đổi cả `_`; pytest kiểm mọi job type có handler đều có file schema inputs.
- **Xác nhận end-to-end** (sau khi user restart `pnpm dev:all` lúc 01:25, worker thật + Gemini, chương QA trang 1):
  "Dịch lại khối" trên khối `같이 산책할래요?` → nút "Đang OCR…" ~15s → bản dịch mới "Đi dạo cùng không?", canvas vẽ đúng ✓.
  OCR vùng (R): kéo khung quanh bóng giữa → ~10s ra khối mới đã dịch "HÔM NAY TRỜI ĐẸP THẬT NHỈ." ✓ (Cmd+Z gỡ khối thử ✓).

### 6. Mất khối đang chọn sau khi trang đang mở được nạp bản mới
- **Tái hiện**: chọn khối → Áp kiểu (hoặc Tìm/Thay) → panel Chọn nhảy về "Trang n · Bấm một khối…".
- **Nguyên nhân**: `syncActive` → `editor.load` reset selection.
- **Sửa**: `syncActive` chọn lại khối nếu id còn trong bản mới. Test unit `chapter-session.test.ts` + e2e Áp kiểu.

### 7. E2E hỏng sẵn sau đổi nhãn Export
`e76956b` đổi drawer "Xuất chương" → "Export chương", nút "Xuất" → "Export"; `chapter-tools` (xuất chương) và `full-flow`
còn tìm tên cũ. Đã cập nhật tên trong test.

### 10. (open — ngoài phạm vi editor) E2E trang series hỏng sẵn
`e76956b` bỏ thanh tab "Mục của series" (navigation), Glossary / Cài đặt dịch thành modal `?tab=`. 4 test còn tìm
`getByRole("navigation", { name: "Mục của series" })`: `routes.spec.ts:12`, `glossary-language-pair.spec.ts:41`,
`series-manage.spec.ts:74` ("series tabs keep the series header…" — test hành vi tab cũ, có thể bỏ), `:90`. Cần viết lại theo
luồng modal (mở link → modal → Đóng → link kế); không sửa vì không thuộc editor và một test kiểm hành vi đã bị bỏ có chủ ý.

### 8. (open — cần user) Chữ dính đỉnh khung khi bản dịch ngắn lại
Sửa "Hôm nay trời đẹp thật nhỉ" (2 dòng) → "Hôm nay đẹp trời ghê" (1 dòng): chữ nằm sát mép trên khung, phần dưới bóng thoại
trống. Đúng hợp đồng layout (`typeset-layout-contract.md` quy tắc 3: baseline tính từ `box.y + pad`, không căn dọc) và
worker `render.py` vẽ y hệt — sửa phải đổi hợp đồng ở cả editor + worker + gate parity. Không tự đổi.

### 9. (open — đề xuất) OCR vùng lỗi không báo gì
Job lỗi `internal` được requeue (backoff 30s·2^n) tới `max_attempts`; suốt lúc đó nút chỉ "Đang OCR…", không có huỷ hay
"đang thử lại". Đề xuất: hiện lỗi lần thử (từ `job.error`) + nút Huỷ. Sau sửa #5 hiếm gặp nên chưa làm.

### 11. Xung đột phiên bản làm `text` và `lines` của khung chữ lệch nhau
- **Tái hiện** (dev, tay): tab A sửa khối 1 thành "Tab A sửa" trong khi bên khác đã ghi khối 1 = "Bên ngoài sửa" (giữ
  `lines` cũ) → 409 → bảng xung đột hiện đúng, nhưng server lưu `text: "Bên ngoài sửa"`, `lines: ["Tab A sửa"]` (v14);
  canvas (và export — renderer dùng `lines`) vẽ "Tab A sửa", ô Bản dịch hiện "Bên ngoài sửa"; nạp lại trang vẫn vậy.
- **Nguyên nhân**: `rebase.ts` gộp từng field độc lập; `lines` là ngắt dòng suy ra từ text + kiểu. Server không đổi `lines`
  so với gốc (thực tế: box AI/Tìm-Thay có `lines: []`, Tìm/Thay server để `lines: []`) → `lines` local được áp cạnh `text`
  server. Cùng lỗi khi mình chỉ đổi font (lines mới) còn server đổi text.
- **Sửa**: sau khi gộp, `lines` theo bên mà box gộp trùng mọi đầu vào ngắt dòng (text, w, h, font_*, line_height, pad,
  letter_spacing, auto_fit); lẫn cả hai → `[]` để renderer ngắt lại (như Tìm/Thay). "Khôi phục bản của tôi" áp cùng luật.
- **Test**: 4 unit `rebase.test.ts` (2 test đỏ khi bỏ bản sửa). Dữ liệu QA trang 1 khối 1 vẫn còn bản lệch tạo lúc tái hiện
  (gõ lại khối là hết) — không sửa DB tay. **31/10 02:08**: đã gõ lại "Xin chào!" qua UI; cả 3 khối trang 1 `text` = `lines` =
  bản dịch ✓.

## Code review toàn diff `main..fix/editor-bug-hunt` (31/10)

Chạy `/ak:code-review` (report đầy đủ: `code-review-261031-0121-branch-diff-report.md`). Không có lỗi nghiêm trọng / bảo mật;
đã kiểm tenant isolation, ghi nguyên tử + version trong transaction, khoá 423, page trùng/khác chương/ẩn/sai kích thước, danh
sách rỗng, race autosave với `editMany` (kết thúc 409 hoặc rebase, không mất dữ liệu), sửa tên schema worker.

- **#12** (`chapter-workspace.tsx`): chỉ có 1 ô thông báo; toast Áp kiểu là chỗ duy nhất hoàn tác lượt đó. Sửa: ô riêng
  `styleUndo` (`NoticeRow`), áp mới thay, hoàn tác xong thì ẩn, có "Đóng". E2E áp kiểu: ẩn trang 2 sau khi áp → toast vẫn còn
  → Hoàn tác khôi phục (đỏ khi bỏ sửa).
- **#13** (`Properties.tsx` + `number-input.ts`): ô Viền ngoài chỉ áp giá trị min (0 = bỏ viền) khi rời ô/Enter (`commitMin`).
  Unit `number-input.test.ts`.
- **#14** (`store.ts`, `use-chapter-session.ts`): `load` nhận `selection` và khôi phục trong cùng 1 cập nhật store — không phát
  null trung gian. Unit `chapter-session.test.ts`.
- **#15 (fixed `32d24e6`, theo đề xuất — user uỷ quyền 31/10)**: endpoint undo nhận `conflicts: "fail" | "skip"` (mặc định
  "fail" → Tìm/Thay, Glossary giữ 409); chỉ Hoàn tác Áp kiểu gửi "skip": khôi phục trang chưa sửa, báo "Đã hoàn tác áp kiểu
  trên N trang · bỏ qua trang 1 vì đã sửa sau đó" (không trang nào → cảnh báo không tự ẩn). Test API `page-state.test.ts`
  (fail vs skip, 400 giá trị sai) + e2e "apply style then edit one page…". Docs `export-and-batch-edit.md`, `editor.md`.
- **#16 (giữ nguyên theo đề xuất)**: `PUT /chapters/:id/states` dùng `assertChapterIdle` như Tìm/Thay → chương đang xử lý (kể cả dịch lại
  1 trang) thì Áp kiểu báo "Chương đang xử lý — chờ xong". Code cũ ghi được các trang không bận nhưng không hoàn tác được. Giữ
  nhất quán với Tìm/Thay trừ khi user muốn khác. Nhánh client bỏ qua trang bận vì thế gần như không chạy.
- **#17 (chấp nhận)**: lượt nguyên tử → 1 trang vừa đổi version là cả lượt 409, báo "đã tải lại, bấm Áp kiểu lần nữa"; không mất
  dữ liệu (rollback).

## Code review các commit phiên 31/10 (b645fbe…32d24e6)

Report: `code-review-261031-0215-session-commits-report.md`. Không có lỗi chặn merge. Đã kiểm: `LINE_INPUTS` đủ đầu vào ngắt
dòng, clone JSON trong draft immer, toast reset khi đổi chương, `commitMin` (0 + Enter/rời ô vẫn bỏ viền, ô số khác không đổi),
giữ chọn chỉ khi khối còn trên cùng trang, undo skip đúng tenant / validate `conflicts` / response chỉ thêm `skipped`.
- **#18** (Medium): `rebase.ts` vẫn coi `lines` là field xung đột — box đã ngắt dòng, mình đổi cỡ chữ, server Tìm/Thay đổi
  text (`lines: []`) → box gộp đúng nhưng danh sách xung đột có "· lines" và Khôi phục không làm gì. Sửa: bỏ `lines` khỏi
  kiểm xung đột của text box (syncLines quyết). Unit: 1 test mới + test cũ đổi kỳ vọng (đỏ khi bỏ sửa).
- **#19** (Low ×3, gộp): nút Hoàn tác ẩn ngay khi bấm (onMutate), trả lại chỉ khi lỗi mạng; không trang nào hoàn tác được →
  tone warn (không tự ẩn). E2E: bấm đúp Hoàn tác → chỉ thấy "Đã hoàn tác…", không có "Không hoàn tác được" (đỏ khi bỏ sửa).
- **#20** (Low, open): `use-chapter-session.ts:161` `refreshAi` chưa truyền selection như `syncActive`; hiếm, để sau.

## Vòng 31/10 02:30–02:50

- **#23 test chập chờn** (report `debug-261031-0231-flaky-ai-write-rules-report.md`): tái hiện 1/4 lượt full suite, 0/25 chạy
  riêng; lỗi `ai-write-rules.test.ts:214` `translateQueued` false. Gốc: `ingest` tạo mọi job `page.prepare` trong 1
  transaction → `created_at` trùng; claim xếp `priority, created_at` (`queue.ts:113`) → thứ tự bất kỳ; test hoàn tất prepare
  theo thứ tự claim, nếu trang 0 xong sau trang 1 thì lượt dịch 1 gồm cả 2 trang. Ép thứ tự ngược → đỏ 100%. Sản phẩm đúng;
  sửa test hoàn tất theo thứ tự trang. Sau sửa: full API 8/8, file 30/30, gate `pnpm test` 3/3.
- **#9 OCR vùng** (`0b0e01c`): job lỗi được requeue có `status: queued` + `error` → trước đây UI chỉ "Đang OCR…". Giờ hiện
  "Lần thử trước lỗi: … (lần N) · thử lại sắp tới/lúc …" theo loại lỗi (`07ec87b`) + nút "Huỷ OCR" (gọi `cancelJob` sẵn có,
  không thêm API). Review phát hiện race → `f990690`: kiểm abort sau mỗi poll, huỷ ngay nếu signal đã abort, huỷ job server
  khi id về sau lúc bấm Huỷ và khi đổi trang/rời editor. Test: unit `ocr-wait.test.ts`, `waitJob` abort (đỏ khi bỏ sửa), e2e
  "cancelling a block's re-OCR…" và "leaving the chapter while…" (đỏ khi bỏ sửa: job còn `queued`). Huỷ khi chưa có job id:
  không test được nếu không thêm thư viện test hook — chỉ đọc code.
- **#20** (`b0612fa`): `refreshAi` truyền selection như `syncActive`; unit `chapter-session.test.ts` (đỏ khi bỏ sửa).
- **#21** (`a797c41`, tách module `40eb9d9`): "… · trang đang mở (trang 1) giữ nguyên vì đã sửa sau đó"; unit
  `undo-style-text.test.ts` + e2e (đỏ khi bỏ sửa).
- Review: `code-review-261031-0245-round3-web-commits-report.md` + review lại sau sửa (không có bug mới).

## Đã đi qua 7 luồng (dev 5180, chương QA đêm)

1. **Mở chương / chuyển trang / zoom / kéo**: thumbnail, pager, phím D/← →, `?page=` đồng bộ ✓. Ctrl+cuộn zoom ✓ (công cụ
   trình duyệt không gửi được ctrlKey — kiểm bằng WheelEvent thật: 76% → 120%). Vừa khung / 100% ✓. Kéo nền ✓. Cuộn chuột
   không sang trang kế (thiết kế từng trang — xem câu hỏi 3).
2. **Chọn khối / sửa**: chọn trên canvas và từ bảng Bản dịch (đổi trang đúng) ✓; Enter sửa tại ảnh, Esc huỷ, Cmd+Enter
   lưu ✓; sửa tại bảng + Enter sang dòng sau ✓. Vùng bấm chọn chỉ là khung chữ (nét đứt), không phải cả bóng thoại.
3. **Font / cỡ / tự khớp / nâng cao / áp kiểu**: đổi font ✓, cỡ chữ (bug #2), tự khớp tắt/bật ✓, nâng cao ✓, áp kiểu (bug
   #1, #3, #6) ✓ sau sửa, Hoàn tác từ toast khôi phục 4 trang ✓.
4. **Di chuyển / đổi cỡ / thêm / xoá khối**: công cụ Chữ (T) vẽ khung + gõ ✓, kéo ✓, đổi cỡ handle ✓, Delete ✓, Cmd+Z trả lại ✓.
5. **Hoàn tác / làm lại**: Cmd+Z, Cmd+Shift+Z, Ctrl+Y ✓; hoàn tác sau đổi trang (trang 1 ↔ 3) ✓; sau thao tác hàng loạt:
   Tìm/Thay, Glossary, Áp kiểu hoàn tác qua nút "Hoàn tác" ✓ (Cmd+Z không hoàn tác lượt hàng loạt — thiết kế); áp bản AI
   từng vùng rồi Cmd+Z ✓.
6. **Lưu / 2 tab / khoá**: "Chưa lưu" → "Đã lưu" ✓, Cmd+S ✓; tab 2 cùng chương: băng "Chương đang mở ở tab khác — chỉ xem",
   công cụ tắt, Delete/Enter/gõ/kéo không đổi gì ✓; đóng tab giữ khoá → tab mới lấy khoá ✓. Xung đột phiên bản — **tái hiện tay
   31/10** (2 tab Chrome mới, chương QA): tab A sửa + lưu → tab B (chỉ xem) khi quay lại tab (`visibilitychange`) nạp lại
   progress/states và vẽ chữ mới ✓; ghi "từ nơi khác" (PUT cùng người giữ khoá, v10→v11) khối 3 trong lúc tab A sửa khối 1 →
   PUT tab A 409 → rebase tự gộp cả 2, server v12 đúng cả 2 ✓; hai bên cùng sửa khối 1 → bảng "2 thay đổi chưa áp được"
   (Khôi phục bản của tôi / Bỏ) ✓ nhưng lộ **bug #11**. Ghi chú: tab chỉ xem để cạnh nhau (2 cửa sổ, không đổi tab) không tự
   cập nhật — chỉ làm mới khi tab được hiện lại (React Query `refetchOnWindowFocus`), poll 15s chỉ lấy thông tin khoá. Chấp
   nhận được vì băng "chỉ xem" đã hướng dẫn; ghi lại để biết.
7. **Dịch / Tìm-Thay / glossary / Export**: Dịch lại trang này (AI thật, 1 trang) → trang bận chỉ xem → "Có kết quả AI mới"
   → Xem khác biệt / Áp / Cmd+Z ✓; Dịch lại khối (bug #5); Tìm/Thay + Hoàn tác ✓ (bug #4); Glossary xem trước/áp/hoàn tác ✓;
   Export drawer ✓, export qua API trên dev: job xong, link tải 302 ✓ (không bấm tải trên UI để không tải file về máy; UI tải
   có e2e).

**Torii** (chỉ xem): mở dự án có sẵn bị chặn "This project is open in another tab. Close it there to open it here." (tab
của bạn đang mở) — không đóng tab của bạn nên không so được editor. Ghi nhận: Torii chặn hẳn tab thứ 2, app này cho xem chỉ
đọc + "Thử lại" — mềm hơn, giữ nguyên.

## Đề xuất đơn giản hoá UI (không tự làm)

1. **Tìm/Thay xem trước** liệt kê mỗi chỗ 2 dòng "Vùng" + "Box chữ" cùng nội dung → gộp 1 dòng / khối (đếm "4 chỗ" trong khi
   người dùng thấy 2).
2. **Glossary**: ô "Cụm cũ trong bản dịch" điền sẵn **từ gốc tiếng Hàn** (`라면`) — không bao giờ có trong bản dịch Việt nên
   xem trước luôn rỗng tới khi người dùng tự hiểu phải gõ cụm Việt cũ. Để trống + placeholder "cụm đang dùng, vd. mì ramyeon".
3. **Panel "Có kết quả AI mới"** còn hiện "0 vùng khác · Áp tất cả (0)" sau khi đã áp hết → tự ẩn (ack) khi hết khác biệt.
4. Vùng bấm chọn khối = cả bóng thoại (bbox vùng OCR) thay vì chỉ khung chữ nét đứt — bấm trong bóng mà trượt chữ thì không
   chọn được.
5. Không có nút +/− zoom trên màn (chỉ Ctrl+cuộn, Vừa khung, 100%) — người dùng trackpad/không biết phím khó tìm.
6. Dropdown Font xuống 2 dòng với tên dài (`BeVietnamPro-Regular`), đẩy cả panel xuống; có thể rút gọn tên hiển thị.

## Câu hỏi cho user

1. Thao tác hàng loạt (Áp kiểu, Tìm/Thay, Glossary) hoàn tác bằng nút "Hoàn tác" chứ không bằng Cmd+Z, và Cmd+Z sau đó không
   lùi được các sửa trước lượt đó trên trang đang mở. Có muốn Cmd+Z gọi hoàn tác lượt hàng loạt vừa làm không?
2. Có muốn chữ **căn giữa dọc** trong khung (bug #8)? Cần đổi hợp đồng layout ở cả editor và worker + chạy lại gate parity.
3. Cuộn chuột tới cuối trang có nên sang trang kế (kiểu đọc webtoon) không? Hiện chỉ đổi trang bằng thumbnail/pager/phím.
4. ~~Khởi động lại worker dev~~ — đã restart 01:25, #5 xác nhận end-to-end.
5. Series "QA đêm" (dữ liệu thử) giữ lại hay xoá? Tôi không xoá. Có thể còn 1–2 tab "QA đêm" mở ở Chrome của bạn (công cụ mất
   quyền điều khiển khi tôi đóng tab khác) — đóng giúp, khoá tự hết hạn sau 15 phút.
6. ~~Hoàn tác Áp kiểu khi đã sửa thêm (#15)~~ — làm theo đề xuất ("skip").
7. ~~Áp kiểu khi chương đang xử lý (#16)~~ — giữ nguyên theo đề xuất.
8. Hàng đợi job: thêm tie-break theo thứ tự trang khi `created_at` trùng (prepare trang 1 trước → lượt dịch đầu sớm hơn)?
