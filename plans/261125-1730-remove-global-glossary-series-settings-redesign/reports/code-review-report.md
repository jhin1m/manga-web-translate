# Review: bỏ glossary chung + tự lưu Cài đặt series

Thời điểm: 2026-11-25 18:12 (Asia/Saigon). Phạm vi: thay đổi chưa commit trên `main` (40 file sửa/xoá + file mới chưa
track). Chỉ đọc, không sửa code.

## Đã chạy (tuần tự, `nice`)

| Lệnh | Kết quả |
|---|---|
| `pnpm -C packages/db exec vitest run test/remove-global-glossary-migration.test.ts` | 2/2 qua |
| `pnpm -C apps/api exec vitest run test/glossary.test.ts test/find-replace.test.ts test/series-memory.test.ts test/tenant-isolation.test.ts` | 66/66 qua |
| `pnpm -C apps/web exec vitest run src/features/series src/features/glossary` | 32/32 qua |
| `pnpm typecheck` | qua (db, api, web) |
| `pnpm lint` | sạch, 510 file |

Không chạy e2e (DB e2e dùng chung).

Đã kiểm thêm:
- Snapshot drizzle 0031 khớp schema: `prevId` nối đúng 0030, `series_id` NOT NULL, bỏ 2 cột, unique 3 cột.
- Journal `when` của 0031 lớn hơn 0030.
- Từ c2f66ce, entry series luôn có `source_lang`/`target_lang` NULL; 0006 chỉ gán cặp cho entry chung. Vì vậy unique mới
  không thể vỡ khi chạy migration.
- Không còn chỗ nào trong api/db/shared đọc `glossary_entries.source_lang`/`target_lang` hay `series_id IS NULL`.
- `PATCH/DELETE /api/glossary/:entryId` dùng `tx.byId` của Scoped (lọc `user_id`). `tenant-isolation.test.ts` có cả hai
  route.
- Migration khớp term chính xác, đúng như snapshot dịch cũ (`seriesGlossaryWhere` + `mergeBySourceTerm` phân biệt hoa
  thường). Web cũ gộp không phân biệt hoa thường, nhưng đó chỉ là phần hiển thị.

## Important

### 1. Migration xoá vĩnh viễn entry chung của cặp ngôn ngữ chưa có series nào

`packages/db/migrations/0031_remove_global_glossary.sql:14` chạy `DELETE FROM "glossary_entries" WHERE "series_id" IS NULL`
không điều kiện. Bước INSERT trước đó chỉ chép vào series **đang có** cùng user và cùng cặp.

Kịch bản: người dùng soạn glossary chung ja→vi để chuẩn bị, hoặc đã xoá series ja→vi cuối cùng. Họ không có series
ja→vi nào. Hoặc họ chưa có series nào. Sau 0031, toàn bộ entry chung ja→vi mất. Không có thông báo, file down không
khôi phục được. Điều này trái với kết quả mong muốn trong plan.md ("Dữ liệu glossary chung đang có không mất").
`docs/deployment-guide.md` (ghi chú 0031) chỉ nói tới entry cặp NULL bị xoá, không nói tới ca này. Bản self-host tự chạy
migration khi cập nhật, nên người dùng không biết là mất. Dữ liệu chỉ còn trong backup lúc boot.

- Độ chắc chắn: cao (đọc từ SQL).
- Hướng sửa (cần user chọn, vì đụng quyết định "dữ liệu không mất"):
  - (a) Release note và deployment-guide nói rõ ca này. Khuyên xuất CSV glossary chung trước khi cập nhật (bản cũ có nút
    xuất).
  - (b) Hoặc migration giữ lại entry mồ côi ở một chỗ đọc được. Không thể giữ trong `glossary_entries` vì `series_id`
    NOT NULL.
  - (c) Tối thiểu: `RAISE NOTICE` số entry bị xoá mà chưa được chép, để thấy trong log migrate.

### 2. `infra/deploy.sh` tự rollback khi smoke lỗi để bản cũ chạy trên schema 0031

Ở `infra/deploy.sh:77-83`: khi smoke hỏng, script `switch_to "$before"` + `restart` nhưng không chạy file down. Trước
0031 điều này an toàn vì migration chỉ thêm. 0031 gỡ cột. Bản API/jobs cũ gọi `tx.select().from(glossaryEntries)`
(`translateSettings` cũ) và drizzle liệt kê `source_lang`/`target_lang`, nên mọi lần enqueue dịch / hiệu đính / chuỗi lô
dịch đều lỗi `column "source_lang" does not exist`. `infra/smoke.sh` chỉ kiểm `/healthz` + đăng ký nên vẫn qua. Script
báo "đã quay về" trong khi dịch hỏng toàn bộ.

Cửa sổ giữa `pnpm db:migrate` (dòng 71) và `restart` (dòng 76) cũng có lỗi này, nhưng chỉ vài giây.

- Độ chắc chắn: cao về cơ chế. Khả năng xảy ra tuỳ smoke có hỏng hay không.
- Hướng sửa:
  - Ghi trong deployment-guide rằng deploy qua 0031 mà tự rollback thì phải chạy down ngay.
  - Hoặc để deploy.sh từ chối tự rollback, chỉ báo động, khi release mới chứa migration có file down kiểu
    "không chỉ thêm".

### 3. Hàng xưng hô thiếu ô chặn mọi thay đổi khác của Xưng hô; đóng modal thì mất im lặng

- `apps/web/src/features/series/settings-draft.ts:53`: `fieldInvalid` xét cả danh sách.
- `use-settings-autosave.ts:115-118` (commit) và `:168` (flush khi đóng): gặp danh sách không hợp lệ thì bỏ qua.

Kịch bản:
1. Bấm "+ Thêm quy tắc" và để hàng trống (hoặc mới gõ người nói).
2. Bấm "Xoá" một cặp AI sai.
3. `set(..., "now")` → commit thấy danh sách thiếu ô → không lưu, chỉ hiện "Điền đủ…".
4. Đóng modal (Esc / Đóng / bấm "Mở" glossary). Flush cũng bỏ qua.

Thao tác xoá mất, `SaveStatus` không báo lỗi. Plan phase 2 ghi "Xoá hàng lưu ngay". Cũng vậy với: sửa xong hàng A
(chưa rời hàng) rồi bấm thêm hàng mới trống. Ca cũ có nút Lưu, người dùng thấy bị chặn; giờ đóng là mất.

- Độ chắc chắn: cao.
- Hướng sửa: khi commit `pronoun_rules`, bỏ qua các hàng còn trống hoàn toàn / chưa đủ ô mà không có `origin` server,
  rồi lưu phần còn lại (giữ hàng dở trong nháp). Hoặc ít nhất: khi đóng mà còn hàng dở, hỏi lại / báo trong `SaveStatus`.

### 4. "Chữ bỏ qua" tự lưu từng đoạn đang gõ, có tác dụng ngay lên lô dịch đang chạy

`series-settings-form.tsx:247` (`"soon"`, 800 ms). Server áp danh sách ngay khi claim `chapter.translate`
(`apps/api/src/jobs/claim-inputs.ts:96`).

Kịch bản: chương đang dịch thì người dùng thấy watermark lọt vào bản dịch, mở Cài đặt và gõ tên nhóm. Họ dừng > 800 ms
sau 3–4 ký tự đầu (≥ `IGNORE_TEXT_MIN` = 3 nên qua kiểm). Danh sách lúc đó có mục là tiền tố, ví dụ "번역팀". Lô dịch
được claim trong lúc ấy bỏ mọi vùng chứa tiền tố đó, không dịch và không chèn chữ. Doc ghi "chương đã dịch không đổi",
nên phải dịch lại mới sửa được. Trước đây phải bấm Lưu nên không có trạng thái nửa chừng.

- Độ chắc chắn: cao về cơ chế. Khả năng: thấp–vừa (cần dịch đang chạy và tiền tố khớp thoại).
- Hướng sửa: ô "Chữ bỏ qua" chỉ lưu khi rời ô (`leave`), không debounce. Hoặc debounce chỉ cho Tên / Giọng văn.

## Nit

### 5. Lượt lưu Xưng hô xếp hàng gửi `pronoun_keys_seen` cũ, cặp vừa lưu có thể sống lại

`use-settings-autosave.ts:123` tạo body ngay lúc commit từ `cur.base`. Nếu lượt trước còn đang chạy, base chưa gồm các
cặp lượt trước vừa gửi. Server (`apps/api/src/routes/series.ts:266-275`) giữ cặp đang có mà không thuộc `keys_seen` và
không có trong body.

Kịch bản: lượt 1 lưu thêm cặp Q (rời hàng). Trong lúc lượt 1 chưa xong, người dùng xoá Q **và** xoá cặp X. Lượt 2 có body
= base0 − X, keys_seen = base0 (không có Q), nên server giữ Q và Q hiện lại sau khi rời bảng. Ca tương tự: đổi tên
người nói hai lần liền trong độ trễ PATCH để lại cặp tên giữa.

Nếu chỉ xoá Q thì tự lành: body null, lượt 1 xong thì lượt sau gửi lại.

- Độ chắc chắn: cao về cơ chế. Khả năng rất thấp (hai thao tác trong ~100–300 ms).
- Hướng sửa: `pronoun_keys_seen` = khoá của base ∪ khoá các `values` đang trong `inflight`. Hoặc tạo body trong
  `mutationFn` (scope chạy tuần tự nên lúc đó base đã cập nhật).

### 6. Tab web cũ (mở trước deploy) crash ở glossary series

API bỏ trường `inherited` khỏi `GET /series/:id/glossary`. Code web cũ:
- `glossary-editor.tsx:105` (bản HEAD): `q.data?.inherited.length`
- `ApplyGlossary.tsx:25` (bản HEAD): `mergeGlossary(q.data.entries, q.data.inherited)`

Cả hai gặp `inherited` là `undefined` nên ném TypeError. Modal Glossary và panel Áp glossary của tab cũ vỡ tới khi tải
lại trang. Deployment-guide mới chỉ nhắc 404 của link Glossary chung.

- Hướng sửa: trả thêm `inherited: []` một bản phát hành, hoặc ghi vào bước 3 của ghi chú 0031.

### 7. `apps/web/src/features/series/source-lang-select.tsx` không còn ai import (code chết)

### 8. Index `glossary_user_series_idx (user_id, series_id)` thừa

Unique mới `(user_id, series_id, source_term)` có cùng tiền tố nên index cũ thừa. Chỉ tốn ghi, không sai.

### 9. Mỗi lượt tự lưu gọi `invalidateQueries(["series"])`

`use-settings-autosave.ts:83`: kéo lại cả list lẫn `GET /series/:id` (chapterStats + thumbs mọi chương). Gõ Giọng văn
dài với nghỉ 800 ms tạo nhiều lần như vậy. Lần refetch sau huỷ lần trước nên không sai, chỉ tốn tải.

### 10. Xoá series khi còn trường chờ debounce sẽ PATCH sau khi đã xoá

Ví dụ vừa gõ Tên xong bấm "Xoá vĩnh viễn" trong 800 ms. Unmount flush PATCH lên series đã xoá, nhận 404 và `onError`
trên component đã gỡ. Vô hại.

## Không thấy lỗi

- Migration chép dữ liệu:
  - JOIN đúng `user_id` + đúng cặp. `NOT EXISTS` trên `series_id` + `source_term` khớp chính xác nên entry series thắng.
  - Không thể trùng term (mỗi cặp + term chỉ có một entry chung).
  - Giữ `origin`, `note`, `case_sensitive`, `created_at`. Không tăng rev là đúng vì glossary hiệu lực không đổi.
  - Thứ tự lệnh đúng (chép → xoá → gỡ unique → NOT NULL → gỡ cột → unique mới). Migrator drizzle chạy trong một
    transaction.
- File down chạy được (test có cả lượt up lại sau down). Cần PG ≥ 15 cho `NULLS NOT DISTINCT`, giống migration cũ.
- `enqueue.ts` / `find-replace.ts` / `series-memory.ts`: chỉ còn lọc `user_id` + `series_id`. `coveredKeys` và trần AI
  không đổi nghĩa sau khi đã chép.
- Autosave:
  - Không thấy vòng lặp lưu vô hạn. Sau khi lưu xong, mốc = giá trị đã gửi. Server chuẩn hoá thì `adopt` lấy về, không
    commit lại.
  - `adoptServer` trả lại đúng object khi không đổi, nên không render lại.
  - Timer được xoá trong flush khi unmount. Callback `onSuccess`/`onError` cấp mutation vẫn chạy sau unmount (TanStack v5).
  - Giọng văn / cặp AI không bị đè khi người dùng không sửa trường đó: body chỉ có một trường, `keys_seen` theo mốc.

## Câu hỏi còn mở

1. Ca 1: user muốn cảnh báo (release note / NOTICE) hay giữ lại entry mồ côi?
2. Ca 2: `infra/deploy.sh` còn dùng cho máy chủ thật không? Hosting nhiều người đang hoãn. Nếu chỉ còn self-host Docker
   (app từ chối chạy khi schema mới hơn) thì ca 2 chỉ cần ghi chú.
