# Review Phase 6: Export + ghép strip + glossary/find-replace

Ngày: 2026-10-20 · Branch `feat/p6-export-glossary-polish` (chưa commit, base = HEAD `1fed467`)
Reviewer: code-reviewer · Không sửa code.

## Điểm: 8/10

Chất lượng tốt: hợp đồng worker được mở rộng theo kiểu cộng thêm, fencing và kiểm key ở cả claim, complete lẫn download; route mới đi qua `sdb`; apply/undo dùng CAS theo version trong 1 transaction. Test API, worker và web xanh. Không có lỗi Critical. Các điểm trừ: (1) UI có kẽ hở race cho phép áp dụng một bộ quy tắc khác với bộ đã xem trước; (2) URL nền ký 15 phút không đủ cho chương lớn; (3) gate parity chưa phủ đường ngắt dòng, trong khi chính find/replace sinh ra đường này; (4) vài lệch nhỏ về NFC, history và tài liệu.

## Phạm vi
- 34 file sửa (+719/−77) + ~25 file mới (~1.6k LOC chính: export.ts, find-replace.ts, export.py, các dialog web, script parity).
- Đã chạy:
  - `pnpm typecheck` ✓; `pnpm lint` (biome, 167 file) ✓; `pnpm test` ✓ (api 114/114, db 3/3, web ✓).
  - `worker: ruff` ✓, `mypy` ✓ (50 file), `pytest` 120 passed, 2 skipped (do thiếu weight model, không liên quan phase này).
  - `pnpm --filter @mtl/shared emit`: JSON schema khớp, không có diff mới. `pnpm --filter @mtl/web build` ✓, editor đã tách chunk riêng `EditorPage-*.js` 491 kB.
  - Rule lifecycle MinIO: đã import thử vào một bucket tạm (đã xoá sau khi thử) → `mc ilm rule ls` hiện `expire-exports, tag mtl-kind=export, 7 ngày` ✓.
- **Chưa chạy được** `pnpm --filter @mtl/web e2e typeset-parity`: cổng 8797 đang bị một tiến trình node khác giữ (PID 45074) và `reuseExistingServer: false`.

## Critical
Không có.

## High
Không có.

## Medium

### M1. Áp dụng được một bộ quy tắc chưa xem trước (race xem trước ↔ sửa ô nhập)
- Vị trí: `apps/web/src/features/chapter/FindReplace.tsx:47-55, 89-92, 241-246`; `apps/web/src/features/glossary/ApplyGlossary.tsx:28-40`.
- Kịch bản:
  1. Người dùng bấm "Xem trước" với `find="Ani"`.
  2. Trong lúc request chưa trả về, họ gõ thêm thành `"Anik"`. `edit()` gọi `flow.invalidate()` → `preview=null`.
  3. Response cũ về sau. `onSuccess` vẫn `setPreview(r)` → nút "Áp dụng" bật lại.
  4. `apply` dùng `input` **hiện tại** (`"Anik"`) kèm `versions` của lần xem trước. Server tính khớp lại theo `"Anik"` và chỉ kiểm version của các page có khớp. Nếu các page đó trùng với tập page của lần xem trước → 200: thay một cụm người dùng chưa xem trước, trong khi danh sách đang hiển thị là của `"Ani"`.
- ApplyGlossary bị y hệt: `rules` lấy từ `picked`/`from` lúc bấm áp dụng, không phải lúc xem trước.
- Điều này phá bảo đảm "bắt buộc xem trước" của plan (#6). Phía server không có gì ràng buộc giữa nội dung đã xem trước và nội dung được áp.
- Sửa:
  - Lưu input/rules đã gửi kèm kết quả xem trước (lấy từ `variables` của mutation hoặc snapshot) và `apply` gửi đúng snapshot đó.
  - Đồng thời bỏ qua response xem trước đã cũ, bằng một bộ đếm thế hệ: `invalidate()` tăng counter, `onSuccess` bỏ qua nếu counter đã đổi.
  - Phòng thủ ở server (tuỳ chọn): xem trước trả về `digest = sha(rules + versions)` và apply bắt buộc gửi lại digest đó.

### M2. URL nền của export ký trần 15 phút, không có cách xin lại → chương lớn fail tất định
- Vị trí: `apps/api/src/jobs/claim-inputs.ts:219` (`presignGet(key, MAX_GET_TTL_S)`); `worker/mtl_worker/export.py:57-58`; `client.py:165` (`raise_for_status`).
- Kịch bản:
  - Worker render tuần tự và tải nền ngay trước khi vẽ từng page.
  - Ingest cho phép tới 1000 page (`MAX_INGEST_PAGES`). Với chương vài trăm page trên Mac chậm, các page sau phút 15 nhận 403 → `HTTPStatusError` → `internal` → retry.
  - Mỗi lần claim lại ký URL mới nhưng thời gian render vẫn như cũ → fail tới hết lượt attempt.
  - Tiêu chí 100 page ≤ 3 phút thì an toàn, nhưng không có gì chặn chương lớn hơn.
- Sửa (chọn một):
  - Worker tải toàn bộ nền về file tạm trên đĩa ngay sau khi claim (đĩa thay cho RAM, giữ được tiêu chí RAM).
  - Thêm endpoint fenced `refresh-inputs`, khi gặp 403 thì xin lại URL nền giống cách upload xin lại PUT.
  - Ít nhất là giới hạn số page cho mỗi export.

### M3. Gate parity không phủ đường "lines rỗng → ngắt dòng", dù find/replace biến đường này thành phổ biến
- Vị trí: `apps/web/e2e/fixtures/typeset-parity.json` (40 box, **0 box có `lines` rỗng**, tất cả `auto_fit=false`, `rotation=0`); `worker/tests/test_render_lines.py:152-177` chỉ so `ensure_lines` với `fit_text` của Python, không so với `measure.ts`.
- Kịch bản:
  - `applyRules` đặt `lines: []` cho mọi box bị đổi (`find-replace.ts:107`).
  - Editor ngắt dòng bằng `canvas.measureText` (`TextBoxNode.tsx:27`), export ngắt bằng Pillow `getlength` (`render.py ensure_lines`).
  - Advance chênh tới ~0.03px (theo contract) là đủ để một từ nằm sát mép rơi xuống dòng khác. Với `auto_fit`, cỡ chữ cũng có thể lệch một bậc.
  - Kết quả: bản export khác với những gì người dùng thấy trong editor, mà gate vẫn xanh.
  - Thuật toán hai bên đã đối chiếu dòng-với-dòng và khớp: tách `\n`, greedy, binary search MIN..MAX, `hard_wrap` có `rstrip`/`lstrip`. Rủi ro chỉ nằm ở số đo advance tại biên.
- Sửa:
  - Thêm box `lines: []` (cả `auto_fit` true/false, text có `\n`, từ quá dài) vào fixture. `scripts/typeset-parity.ts` ghi kèm `lines` và `font_size` do `ensure_lines` tính, spec so `kit.layout(box)` phải trùng y hệt.
  - Hoặc khi editor mở page, chốt `lines` cho box đang rỗng và lưu lại, để export luôn chỉ vẽ `lines` đã chốt.

### M4. Export đang lúc "dịch lại" làm mất page một cách im lặng
- Vị trí: `apps/api/src/jobs/claim-inputs.ts:213` (`translated = pg.status === "ready" && …`); `apps/api/src/routes/export.ts:83-91` (không kiểm chương có bận hay không).
- Kịch bản:
  - Retranslate chuyển page `ready` → `translating` trong khi state cũ vẫn còn.
  - Gọi export lúc đó, với `include_untranslated=false`: các page này (layout `pages`) hoặc cả slice chứa chúng (layout `original_slices`) bị loại khỏi file mà không có cảnh báo nào. Với `include_untranslated=true`: xuất ảnh gốc không chữ.
  - UI có ẩn nút khi `busy`, nhưng API thì không chặn.
- Sửa (chọn một):
  - Coi `translating` có `ai_rev > 0` (đã có state) là đã dịch.
  - Trả 409 `chapter_busy` khi chương có `chapter.translate` đang chạy.
  - Ghi số page bị bỏ qua vào `result` để UI hiển thị.

## Low

1. **Thay chuỗi có thể sinh text không phải NFC.**
   - Vị trí: `find-replace.ts:68-75`.
   - Ghép các chuỗi NFC lại với nhau không đảm bảo ra NFC. Ví dụ: thay `q` → `a` trong `"q̂"` cho ra `"â"`, chuỗi này không phải NFC (NFC là `â`).
   - State được ghi mà không qua zod. Sau đó mọi `PUT /state` của editor cho page đó sẽ 400 vì `NfcText` bị vi phạm.
   - Sửa: `.normalize("NFC")` kết quả, rồi `PageState.parse(r.state)` trước khi ghi.
2. **Hoàn tác có thể chỉ khôi phục một phần khi history bị prune.**
   - Vị trí: `find-replace.ts:195-212`.
   - Nếu page A có hơn 50 version sau batch, row batch của A đã bị `pruneHistory` xoá. Khi đó `hist` chỉ còn page B, không có conflict → chỉ B được khôi phục, A thì không.
   - Qua UI khó xảy ra vì `batch_id` mất khi đóng dialog, nhưng qua API thì được.
   - Sửa: lưu số page của batch (hoặc trả `pages` lúc apply rồi so lại); thiếu page nào → 409.
3. **Tên entry zip dùng `{ord+1:03d}`.**
   - Vị trí: `worker/mtl_worker/export.py:123`.
   - Chương có 1000 page/slice cho ra `1000.png`, sắp xếp theo từ điển sẽ đứng trước `101.png`, nên reader sắp sai thứ tự.
   - Sửa: dùng `04d`, hoặc tính độ rộng theo `n_files`.
4. **Tài liệu hợp đồng chưa cập nhật và comment tham chiếu sai.**
   - `docs/typeset-layout-contract.md:21` vẫn ghi "Server chỉ vẽ, không tự ngắt lại", mâu thuẫn với `ensure_lines` và `docs/editor.md`.
   - `find-replace.ts:9-10` ghi "hợp đồng layout mục 5", nhưng mục 5 là Stroke.
   - Sửa: thêm vào contract một mục "lines rỗng → ngắt theo layoutBox/ensure_lines" và sửa tham chiếu trong comment.
5. **Lifecycle chỉ có ở dev compose, và môi trường đang chạy chưa có rule.**
   - Container `minio-init` hiện tại chạy từ trước thay đổi (log chỉ có "bucket mtl ready (private)"), nên cần chạy lại `pnpm infra:up` hoặc `minio-init`.
   - Chưa có cấu hình prod. Cần ghi vào checklist deploy (Phase 8).
   - API vẫn cắt ở 7 ngày theo `updated_at`, nên không lộ link. Chỉ là file không bị xoá.
6. **Migration down không chắc chắn.**
   - Vị trí: `0002_glossary_term_unique.down.sql`.
   - Lệnh `DELETE … WHERE id = max(id)` sẽ xoá nhầm bản ghi migration nếu sau này đã có 0003.
   - Sửa: xoá theo `hash`/`created_at` của 0002.
   - Phần up có xoá bản trùng (giữ bản `updated_at` mới nhất), điều này đã được ghi rõ là không khôi phục được. Postgres 17 hỗ trợ `NULLS NOT DISTINCT` ✓.
7. **Gộp glossary ở client không khớp server.**
   - Client `mergeGlossary` (`ApplyGlossary.tsx:15-18`) so khớp không phân biệt hoa thường; server `glossaryRules` (`find-replace.ts:244-247`) so khớp chính xác.
   - Ví dụ: workspace có `Kiếm`, series có `kiếm` → client ẩn entry `Kiếm`, server vẫn có cả hai.
   - Ảnh hưởng nhỏ nhưng nên thống nhất một luật.
8. **Highlight ở client bỏ qua NFC và cờ phân biệt hoa thường.**
   - `splitHighlight` không chuẩn hoá NFC phía client, và glossary luôn truyền `caseSensitive: false` (`ApplyGlossary.tsx:117`).
   - Chỉ ảnh hưởng hiển thị, server vẫn đúng.
9. **Hoàn tác mất khi đóng dialog.**
   - `batch_id` chỉ nằm trong state của dialog. Thêm vào đó, đóng dialog sẽ nhả khoá (unmount `useChapterLock`), nên nếu editor của cùng người đang mở ở tab khác thì lần lưu sau nhận 423. Đây là giới hạn đã có từ thiết kế khoá theo user.
   - Gợi ý: hiện "Hoàn tác lần áp dụng gần nhất" ở màn chương (lấy batch gần nhất từ history).
10. **`attachmentDisposition` dùng `encodeURIComponent`, vốn để nguyên `'()*`.**
    - Vị trí: `export.ts:78`.
    - RFC 8187 không cho các ký tự này trong `filename*`. Trình duyệt chịu được, nhưng nên mã hoá thêm `'`.
11. **"Đánh dấu box bị đổi" mới chỉ có trong danh sách xem trước** ("box đổi — ngắt dòng lại khi vẽ"). Sau khi áp dụng, editor không có cờ nào. Xem bảng tiêu chí.

## Tiêu chí phase

### Requirements
| # | Yêu cầu | Kết quả | Bằng chứng |
|---|---|---|---|
| R1 | Job `chapter.export` {format, layout, quality, include_untranslated}, không có `fixed_height` | Đạt | `job.ts` ExportFormat/ExportLayout, `export.ts:33-38` |
| R2 | Renderer vẽ `lines[]` (NFC, baseline, stroke ra ngoài, bắt buộc raqm); thiếu lines → wrap; nền = `clean/{clean_rev}` | Đạt (xem M3 về parity của wrap) | `render.py ensure_lines/render_page_state`, `claim-inputs.ts:217-219` |
| R3 | Ghép strip theo `source_map`, theo `ord` | Đạt | `SliceAssembler`; ingest phủ kín mọi hàng của slice (`ingest.py:134-140`), nên `max(src_y+h)` = chiều cao gốc |
| R4 | Key `ws/{ws}/ch/{ch}/export/{jobId}`; download có xác thực → 302 presigned ≤ 5', attachment; lifecycle 7 ngày | Đạt (lifecycle chỉ ở dev, L5) | `export.ts:117-136`, `storage.ts EXPORT_GET_TTL_S=300`, test export 142/163 |
| R5 | Find/replace chữ thường trong chương, tuỳ chọn phân biệt hoa thường, xem trước bắt buộc, 423, 1 transaction + `batch_id`, version +1, hoàn tác theo batch | Đạt ở server; UI có kẽ hở xem trước (M1) | `find-replace.ts`, test find-replace 128-218 |
| R6 | Áp glossary (không gọi LLM), cùng khoá/history/batch, đánh dấu box bị đổi | Một phần (đánh dấu chỉ có trong xem trước, L11) | `glossaryRules`, `ApplyGlossary.tsx` |

### Success Criteria
| Tiêu chí | Kết quả | Ghi chú |
|---|---|---|
| 40 slice `original_slices` → đúng 40 file, đúng kích thước | Đạt ở mức logic, chưa chạy với dữ liệu thật | `test_original_slices_restore_each_source_exactly` kiểm khôi phục chính xác trên bộ nhỏ; chưa có case 40 slice |
| Parity ≤ 1px trên 10 page_state + owner soi 5 trang | Không kiểm được ở lượt review này | Fixture có 10 page / 40 box nhưng không có box xoay và không có box `lines` rỗng (M3); e2e bị chặn vì cổng 8797 bận; phần soi mắt là việc của owner |
| 100 trang ≤ 3', RAM ≤ 3GB | Không kiểm được | Thiết kế ổn: zip ghi ra đĩa, ZIP_STORED, buffer slice được giải phóng (`test_assembler_window_frees_buffers`), upload streaming. Chưa có số đo |
| Link hết hạn ≤ 5'; người ngoài workspace → 404 | Đạt | Thành viên workspace B hỏi job của A → 404 (test 156). Người không phải thành viên của `:ws` → 403 do middleware chung (đúng pattern có sẵn) |
| Find/replace 50 trang < 2s, hoàn tác được; không khoá → 423 | Đạt | Test performance 260, test 140/179 |
| CBZ mở được trong YACReader/Komga | Không kiểm được | ComicInfo.xml đứng đầu, entry `NNN.jpg/png`; cần owner thử |

## Hồi quy ở các touchpoint (b)
- **claim**: export lấy `outputRev` null (không có `pageId`) và không bump `nextRev`. `buildInputs` lỗi → job fail, không 500 cả lượt claim (`queue.ts:133-141`) ✓. Test 1000 job claim song song vẫn xanh.
- **complete**: `applyResult` cho export so `result.key` với key cấp lúc claim, `head` để lấy bytes thật, ghi đè `result` sau khi đã set succeeded ✓. Lần complete trùng → no-op ✓.
- **presign**: output khác export vẫn `image/png`, không có tagging. Đã thêm `headers` (optional) vào response ✓. Worker cũ bỏ qua `headers`.
- **reaper/cancel**: export là job cấp chương, nên `cancelChapter` cũng huỷ export (chấp nhận được), `terminal` rơi vào `default` ✓.
- **Kiểm bận khi ingest**: export đang chạy chặn ingest lại (`chapter_busy`). Hợp lý vì ingest xoá page.
- **Editor save/lock**: apply/undo CAS theo version. Editor nhận conflict thì rebase (`save.ts:144`). `writeAiState` dùng `FOR UPDATE`, gặp `state_origin='user'` thì không ghi đè. Thứ tự nào cũng an toàn (apply bị CAS chặn → 409 rollback, hoặc AI chỉ bật `ai_update_available`) ✓.
- **Glossary CRUD**: `writeOrConflict` bọc create/import/patch; CSV đã dedupe trước, nên import `replace` không vấp unique ✓.
- **`pruneHistory`** chỉ đổi từ private sang export, không đổi hành vi ✓. Còn tồn tại song song một bản trong `page-state-writer.ts`, nợ cũ, không phải do phase này.

## Thay đổi hợp đồng (c), đều có chủ đích, đều là cộng thêm
- `OutputName` thêm `export`. `PresignedOutput.headers?` (claim-response, presign-outputs-response schema). Schema mới `inputs-chapter-export`.
- `JobResult chapter.export.bytes` bị server ghi đè bằng kích thước thật của object.
- `presignPut(key, ct, ttl, opts?)` thêm tham số tuỳ chọn. `storage.objectTags` mới.
- Route mới:
  - `POST /chapters/:id/export`, `GET /chapters/:id/exports`, `GET /exports/:jobId`, `GET /exports/:jobId/download`
  - `POST …/find-replace/{preview,apply,undo}`, `POST …/glossary-apply/{preview,apply}`
- DB: `UNIQUE NULLS NOT DISTINCT (workspace_id, series_id, source_term)`. Migration xoá các bản trùng.
- Worker: `DEFERRED_TYPES` rỗng → capability mặc định nay có `chapter.export`. `WorkerApi.upload_file` mới.
- Hằng mới trong shared: `EXPORT_FILE`, `EXPORT_RETENTION_DAYS`, `EXPORT_OBJECT_TAG`.

## Pattern (d)
Route dùng `sdb` scoped; comment tiếng Việt; tên file mới theo kebab-case cho TS lib/route. Component React dùng PascalCase (`ExportDialog.tsx`, `FindReplace.tsx`, `Modal.tsx`), đúng như plan và theo cách đặt tên đã có ở editor (`TextBoxNode.tsx`). Không có `any` mới ngoài một chỗ `biome-ignore` có lý do (Konva UMD) trong spec e2e. `ExportFormat`/`ExportView` khai lại bằng tay ở `web/api.ts` thay vì import từ `@mtl/shared`: lặp nhẹ, giống pattern sẵn có của web.

## Bảo mật
- **Tải export**: key dựng lại từ `ws` của route, kiểm `r.key === key` và `keyBelongsToWorkspace`, TTL 300s, `Content-Disposition` nằm trong chữ ký (`ResponseContentDisposition`), CR/LF bị loại (`\p{Cc}`), `Cache-Control: no-store` ✓.
- **PUT**: content-type và `x-amz-tagging` nằm trong chữ ký (`unhoistableHeaders`). Test xác nhận PUT thiếu header bị từ chối ✓.
- **Tenant**: 6 route find/replace và 4 route export đều có trong `tenant-isolation.test.ts` ✓. Hoàn tác lọc history theo page của chương và của workspace ✓.
- **XSS**: phần highlight render bằng React text node, không có `dangerouslySetInnerHTML`. Regex được escape ✓.
- **Regex DoS**: không có, vì input được escape và là chuỗi literal ≤ 200 ký tự.

## Khuyến nghị theo thứ tự
1. M1: gắn snapshot input/rules vào kết quả xem trước, bỏ qua response cũ (có thể thêm digest ở server).
2. M3: thêm box `lines` rỗng (và box xoay) vào fixture parity; chạy gate trên CI.
3. M2: prefetch nền ra đĩa, hoặc thêm cách xin lại URL input.
4. M4: định nghĩa lại `translated` hoặc chặn export khi đang dịch lại.
5. L1 (NFC + validate state trước khi ghi), L4 (tài liệu contract), L3 (`04d`).
6. Chạy `pnpm --filter @mtl/web e2e typeset-parity` khi cổng 8797 trống; owner soi 5 trang và mở CBZ trong YACReader/Komga; đo 100 trang/RAM.

## Câu hỏi còn mở
- Có chủ đích cho "đánh dấu box bị đổi" chỉ hiện ở xem trước, hay cần một cờ lưu bền trong state (ví dụ `region.flags`) để editor hiển thị?
- Người không phải thành viên gọi `/download` nhận 403 (theo middleware). Như vậy có đủ cho tiêu chí "→ 404" không, hay muốn trả 404 đồng nhất để không lộ workspace?

Status: DONE_WITH_CONCERNS
Summary: Phase 6 đạt phần lớn yêu cầu; typecheck, lint, test API/web/worker và build đều xanh. Không có lỗi Critical/High. Có 4 lỗi Medium: race giữa xem trước và áp dụng ở UI, URL nền 15 phút với chương lớn, gate parity không phủ đường ngắt dòng, export lúc đang dịch lại làm mất page im lặng.
Concerns/Blockers: e2e parity chưa chạy được (cổng 8797 bận); các tiêu chí hiệu năng/RAM, CBZ reader và soi mắt cần owner kiểm thủ công.
