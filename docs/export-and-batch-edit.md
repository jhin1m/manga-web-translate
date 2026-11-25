# Xuất chương + sửa hàng loạt (find/replace, áp glossary)

Trên UI (màn chương, xem [editor.md](./editor.md)): **Xuất** là menu dưới nút Xuất (`features/chapter/export-menu.tsx`; mở
bằng nút chính "Xuất", mục "Xuất" trong menu ⋯ khi chương có trang lỗi, hoặc `?drawer=export`; chi tiết ở [Menu Xuất chương](#menu-xuất-chương); tải qua 302 bên dưới). **Tìm / Thay** và **Áp glossary** là 2 tab
của panel **Văn bản** trên rail công cụ (tab "Tìm / Thay" | "Glossary", panel rộng 560px; Ctrl/Cmd+F mở thẳng "Tìm /
Thay"), không có hộp thoại modal; chỉ dùng được khi chương đã dịch xong. Trước khi gọi `apply` UI lưu hết sửa chưa lưu (`beforeWrite`). Apply / hoàn tác
chỉ chạy khi chương không đang cắt trang / xử lý (409 `chapter_busy`).

## Xuất chương (`chapter.export`)

Render phía server bằng chính `worker/mtl_pipeline/render.py` (một renderer cho auto-typeset và export, hợp đồng
[typeset-layout-contract.md](./typeset-layout-contract.md)): nền = `clean/{pages.clean_rev}.png`, vẽ `text_boxes`
(bỏ `hidden`). Box thiếu `lines` mà có `text` → `render.ensure_lines` ngắt dòng giống hệt `layoutBox` của editor
(`apps/web/src/features/editor/measure.ts`); editor cũng vẽ theo cách đó khi gặp box như vậy.

| API | Ghi chú |
|---|---|
| `POST /api/chapters/:id/export` | `{format: png_zip\|cbz, layout: original_slices\|pages, quality=90, include_untranslated=false}` → 202 `{job, created}`; chưa có page → 409 `no_pages`; chương đang ingest/xử lý → 409 `chapter_busy`; bấm lại khi job cũ còn chạy và chương chưa đổi → trả job cũ |
| `GET …/chapters/:id/exports` | ≤ 10 export gần nhất (7 ngày) |
| `GET /api/exports/:jobId` | trạng thái, `bytes`, `expires_at`, `download_url` |
| `GET /api/exports/:jobId/download` | 302 → link `/files` ký 5' + `Content-Disposition: attachment`; chưa xong 409; quá 7 ngày/đã xoá 410; job của người dùng khác 404 |

- **Inputs** (chốt lúc claim, `ExportInputs`): page theo `ord`, `translated` = page `ready` + có ảnh sạch (page khác
  dùng ảnh gốc, không vẽ chữ; bị bỏ khi `include_untranslated=false`), `state`, `source_map`, slice gốc theo `ord`.
- **Layout**: `pages` = `{ord+1:03}` mỗi page; `original_slices` = cắt lại đúng slice upload gốc theo `source_map`,
  ghép theo cửa sổ trượt (render từng page, dán vào buffer slice đích, slice đủ hàng thì ghi ra zip) — không giữ cả
  strip trong RAM. Slice là ảnh **đã cắt mép** (`source_files.trim`, xem [editor.md](./editor.md)): `src_y` tính theo ảnh
  đã cắt nên slice xuất cao `H − top − bottom` và không còn dải credit. Slice có đoạn thuộc page chưa dịch bị bỏ khi `include_untranslated=false`.
- **Trang đã ẩn** (`pages.skipped`, xem [editor.md](./editor.md)): `ExportInputs.pages[].skipped`. Layout `pages`
  bỏ trang ẩn, file vẫn đánh số liên tục `001…n`; `original_slices` bỏ slice nằm trọn trong trang ẩn, slice vắt qua
  trang ẩn giữ pixel gốc ở đoạn đó. Hết trang hiện → 409 `no_pages`. Tìm/Thay và Áp glossary không đọc/ghi trang ẩn.
  Ẩn / khôi phục trang sau lần xuất thành công cuối ghi `pages.skip_changed_at` (giờ DB) → chương hiện "Xuất lại" (`reexport`).
- **Tải nền**: worker tải hết ảnh nền ra thư mục tạm trước khi render (URL ký 15', render chương dài có thể lâu hơn).
  Tên file `{ord+1}` đệm ≥ 3 chữ số (đủ chữ số khi > 999 ảnh).
- **Ảnh**: `png_zip` luôn PNG; `cbz` quality 100 → PNG, < 100 → JPEG. Zip ghi ra file tạm (entry STORED), CBZ có
  `ComicInfo.xml` tối thiểu.
- **Output**: `u/{user}/ch/{ch}/export/{jobId}.{zip|cbz}`. Presigned PUT mang `headers` đã ký (`content-type` +
  `x-amz-tagging: mtl-kind=export`) — worker gửi đúng các header này, xin URL mới ngay trước khi upload (TTL ≤ 120s).
  Complete chỉ nhận đúng key cấp lúc claim, `bytes` lấy từ kích thước file.
- **Xoá sau 7 ngày**: job `export-cleanup` trong `pnpm jobs` (mỗi giờ, `apps/api/src/jobs/export-cleanup.ts`) xoá
  file `…/export/` cũ hơn `EXPORT_RETENTION_DAYS` cùng file tạm ghi dở.

## Menu Xuất chương

Một nút, ít lựa chọn (`export-panel.tsx`, nhãn/trạng thái thuần ở `export-options.ts`, cảnh báo ở `export-warnings.ts`):

- **Cảnh báo "Trước khi xuất"** — hiện thành 1 dòng "N chỗ cần xem" (bấm mở danh sách; không có cảnh báo thì không có dòng);
  mỗi câu trong danh sách nói hậu quả trong file; có cảnh báo vẫn xuất được:
  - "N trang chưa dịch → không có trong file" (trang không `ready`: lỗi, đang chạy, chờ dịch; **ẩn** khi bật "Đưa cả
    trang chưa dịch vào");
  - "N khối chưa dịch → để trống chữ" (bản dịch trống, bỏ SFX);
  - "N trang AI có bản mới → xuất bản đang hiện";
  - "N khối tràn khung → chữ có thể bị cắt".
  Trang đã ẩn không tính. "Xem N chỗ này" (khối tràn / chưa dịch / AI có bản mới) mở tab Bản dịch (panel Văn bản) lọc "Chỉ khối cần xem".
- **"Tuỳ chọn"** (thu gọn, kèm dòng tóm tắt, VD "Ảnh .zip · 96 ảnh như lúc tải lên", ".cbz · 30 trang đã cắt · Cao · gồm
  trang chưa dịch"):
  - Định dạng: "Ảnh trong .zip — để đăng web" (`png_zip`) / ".cbz — đọc bằng app đọc truyện" (`cbz`).
  - Chất lượng ảnh (chỉ CBZ): Gốc / Cao / Nhẹ = quality 100 (PNG) / 90 / 75; mặc định Cao.
  - Cách chia ảnh (chỉ hỏi khi số ảnh tải lên ≠ số trang đã cắt; manga 1 ảnh = 1 trang thì hai cách cho cùng kết quả nên
    ẩn): "Giống lúc tải lên (N ảnh)" (`original_slices`, mặc định) / "Theo trang đã cắt (M ảnh)" (`pages`; M không tính trang ẩn).
  - "Đưa cả trang chưa dịch vào (ảnh gốc, chưa có bản dịch)" (`include_untranslated`).
- **Nút "Tải chương (.zip|.cbz)"**: lưu sửa chưa lưu → `POST …/export` → tiến độ ngay tại nút ("Đang xuất 40%…") → xong tự tải đúng
  1 lần qua link có xác thực, kèm link "Tải xuống" tại chỗ phòng trình duyệt chặn tự tải. Bấm lại sau khi xong = xuất mới.
  Mở lại menu khi còn lượt đang chạy → theo dõi tiếp lượt đó (và tự tải khi xong). Menu đóng lúc xong → thông báo "Đã
  xuất xong." + "Tải xuống". Hết ngân sách → nút "Tạm dừng — hết ngân sách", tự xuất tiếp khi có lại. Link hết hạn →
  "Link đã hết hạn — bấm tải lại để xuất mới".
- **"Lần trước · 2 giờ trước · …" + "Tải lại"** (khi không có lượt đang theo dõi; hết hạn thì nói rõ): lượt xuất thành công gần
  nhất. Danh sách các lượt gần đây (nhãn như ".zip · như lúc tải lên · Cao") và huỷ lượt đang chạy nằm ở drawer Hoạt động.

## Find/replace và áp glossary (panel Văn bản: tab "Tìm / Thay", "Glossary")

Chữ thường (không regex), phạm vi trong 1 chương, thay trong `region.translation` và `text_box.text`; box bị đổi có
`lines: []` (renderer ngắt lại).

| API (`/api/chapters/:id/…`) | Ghi chú |
|---|---|
| `find-replace/preview` `{find, replace, case_sensitive}` | không cần khoá; → `{matches, total, truncated, versions}` |
| `find-replace/apply` `{…, versions}` | cần khoá chương (423); chương đang cắt trang / xử lý → 409 `chapter_busy`; page đổi sau preview (page có khớp **hoặc** page trong `versions`, kể cả khi giờ hết khớp — áp lại cùng bản xem trước) → 409 `preview_stale`. UI tắt "Áp dụng" sau khi áp tới lần Xem trước kế. Thành công → `{batch_id, pages, replaced, versions}` (`versions` = version mới của từng page đã ghi) |
| `find-replace/undo` `{batch_id, conflicts?}` | cần khoá, chương không bận (409 `chapter_busy`); → `{pages, skipped}`. `conflicts` mặc định `"fail"`: page đã bị sửa tiếp (hoặc đã hoàn tác) → 409 `undo_conflict`, không ghi gì; `"skip"`: bỏ qua page đó, khôi phục phần còn lại, `skipped` = id page bỏ qua |
| `glossary-apply/preview` `{rules: [{source_term, from}]}` | target lấy từ glossary của series (term không có trong series → 400 `unknown_terms`); chỉ thay trong vùng có `source_text` chứa term nguồn và box gắn vùng đó |
| `glossary-apply/apply` `{rules, versions}` | như find-replace (cũng 409 `chapter_busy` khi chương đang chạy); hoàn tác qua `find-replace/undo` |

Apply = 1 transaction: mỗi page ghi bản cũ vào `page_state_history` với chung `batch_id`, version +1,
`state_origin = user` (job AI sau đó không ghi đè, xem luật AI-không-ghi-đè). Undo khôi phục khi version hiện tại =
version lúc áp + 1. History giữ 50 bản/page — batch quá cũ có thể không còn (404).

"Áp kiểu cho khối cùng loại" (panel khối) cũng ghi theo `batch_id` nhưng client tự tính state (layout trình duyệt) và gửi
`PUT /api/chapters/:id/states {pages: [{page_id, version, state}]}` (1 transaction; khoá 423, `chapter_busy`, page ẩn /
bận / khác chương / sai kích thước bị từ chối, version lệch → 409 `version_conflict` kèm `pages`, không ghi page nào);
hoàn tác qua `find-replace/undo` với `conflicts: "skip"` từ toast (trang đã sửa tiếp được giữ nguyên, toast nêu số trang đã hoàn tác + các trang bị bỏ qua; bỏ qua hết → báo không hoàn tác được).

## Ẩn chữ bỏ qua trong chương đã dịch (Cài đặt series → "Ẩn chữ khớp trong chương đã dịch…")

Dùng lại lõi sửa hàng loạt của find/replace (`apps/api/src/lib/batch-edit.ts`): phép sửa là hàm thuần
`state → {state, matches}`; preview/apply/undo, history và `batch_id` như trên. Phép này đặt `hidden = true` cho box
chưa ẩn có `region_id` trỏ vào vùng có `source_text` khớp danh sách chữ bỏ qua đã **lưu** của series (box không gắn
vùng khớp không bị đụng; không xoá box, không đổi bản dịch). Page bị đổi → chương vào "cần xuất lại".

| API (`/api/series/:seriesId/ignore-apply/…`) | Ghi chú |
|---|---|
| `preview` `{}` | → `{chapters: [{chapter_id, number, boxes, pages, samples, versions}], skipped: [{chapter_id, number, title, reason}], total_boxes}`; `reason`: `locked` (chương đang mở ở tab khác) / `busy` (có job hoạt động) |
| `apply` `{versions}` | `versions` gộp từ preview; → `{batch_id, boxes, chapters, skipped}` (`batch_id` null nếu không chương nào được áp); `reason` thêm `changed` (page đổi sau preview) |
| `undo` `{batch_id}` | → `{pages, chapters, skipped}`; chương đang mở ở tab khác → `locked`; page đã sửa tiếp → bỏ qua (`changed`, kèm số trang) thay vì 409; không còn bản ghi nào của batch → 410 `batch_not_found` |

Khác find/replace: không cần người dùng giữ khoá sẵn — mỗi chương lấy khoá riêng ngay trước khi ghi và nhả sau (giữ
nguyên nếu chính mình đang giữ), 1 transaction/chương; chương bị bỏ qua không làm hỏng chương khác.

## Glossary

Glossary chỉ có **một cấp: riêng từng series** (`glossary_entries.series_id` NOT NULL). Entry không gắn cặp ngôn ngữ:
áp theo cặp hiện tại của series, vẫn áp khi series đổi nguồn/đích (form Cài đặt cảnh báo, không chặn lưu). Dùng khi dịch
(`settings.glossary` của `chapter.translate`), khi áp glossary và ở tab Glossary của series.

| API (`/api/…`) | Ghi chú |
|---|---|
| `series/:id/glossary` (GET/POST) | GET → `{entries}` sắp theo từ gốc |
| `series/:id/glossary/csv` (GET/POST) | CSV 4 cột `source_term,target_term,note,case_sensitive`; `replace` xoá mọi entry của series; file `glossary-series-<id>.csv` |
| `glossary/:entryId` (PATCH/DELETE) | series lấy từ entry, không đổi được qua PATCH |

Một term mỗi series: ràng buộc `UNIQUE (user_id, series_id, source_term)` (`glossary_entries_scope_term_uq`). Request
đua nhau → 409 `duplicate_term`. Mọi thay đổi tăng `glossary_rev` của series đó trong cùng transaction.

**Glossary chung đã bỏ** (migration 0031): entry chung (`series_id` null, theo cặp `source_lang`/`target_lang`) được chép
vào mọi series cùng người dùng, cùng cặp, mà series chưa có term đó (entry series vẫn thắng như trước) rồi xoá; entry
không có series cùng cặp (hoặc cặp null) được giữ trong bảng `glossary_global_archive` (app không đọc); cột
`source_lang`/`target_lang` bị gỡ. Trang `/glossary`, dòng menu tài khoản và route `GET/POST /api/glossary[/csv]` không
còn (404). Lấy lại entry lưu trữ / rollback: xem
[deployment-guide.md](./deployment-guide.md#ghi-chú-bỏ-glossary-chung-migration-0031).

### AI tự bổ sung trí nhớ series (nhãn "AI")

Sau mỗi lô dịch, AI tự ghi vào series (không thêm lượt gọi LLM; hợp đồng result ở
[job-queue-worker](./job-queue-worker.md#luồng-dịch-chương-xoá-chữ--ocr-rồi-chuỗi-lô-dịch)): thuật ngữ thành entry
glossary series, cặp xưng hô mới thành hàng trong Xưng hô, và Giọng văn khi ô còn trống và người dùng chưa tự đặt. Mục AI ghi có nhãn
"AI" ở dòng glossary, dòng Xưng hô và ô Giọng văn; không có danh sách duyệt, nút Nhận/Bỏ hay badge đếm. Code:
`applyLearned` ở `apps/api/src/lib/series-memory.ts` (trần, lọc, thứ tự khoá).

- Sửa mục AI thì nhãn mất (thành của người dùng). Xoá thì AI không ghi lại: bảng `series_suggestions` giờ là sổ khoá
  AI đã gặp, khoá gồm cặp ngôn ngữ của series, nên đổi cặp ngôn ngữ thì AI học lại được.
- Ghi tăng `glossary_rev`, **không** tăng `settings_rev`: lô kế dùng ngay, không chạy lại Bước 1.
- Trần: 5 thuật ngữ và 3 cặp mỗi lô; tối đa 200 entry AI còn sống trong glossary series (xoá bớt thì học tiếp) và 200
  cặp xưng hô mỗi series.
- Cài đặt dịch tự lưu từng trường: mỗi lượt chỉ gửi trường vừa đổi kèm `pronoun_keys_seen` (các cặp form đã thấy),
  nên không làm mất cặp xưng hô hay Giọng văn AI vừa ghi lúc form đang mở; tab cũ chưa tải lại cũng không xoá được mục
  AI. Phần AI vừa ghi hiện vào trường người dùng không đang sửa. Xem `memoryColumns` ở `apps/api/src/routes/series.ts`
  và `apps/web/src/features/series/use-settings-autosave.ts`.
- Nâng cấp từ bản có "Gợi ý từ AI": gợi ý cũ còn chờ duyệt **không** được áp; migration 0030 giữ chúng làm khoá đã gặp.

| API (`/api/…`) | Ghi chú |
|---|---|
| `series/:seriesId/suggestions` (GET) | luôn trả danh sách rỗng; giữ một bản cho tab web cũ chưa tải lại (PATCH gợi ý đã bỏ) |

## Gate parity Konva ↔ render.py

`apps/web/e2e/typeset-parity.spec.ts` vẽ 10 page_state golden bằng code editor thật (`drawBoxText`) và so bbox mực
từng dòng với fixture `apps/web/e2e/fixtures/typeset-parity.json` (sinh từ render.py): lệch ≤ 1px. Đổi render.py /
measure.ts / font → `node scripts/typeset-parity.ts` (sinh lại fixture; `--check` để so) rồi
`pnpm --filter @mtl/web e2e typeset-parity`. Gồm 8 box thiếu `lines` (ngắt dòng + cỡ auto-fit phải trùng); chưa gồm box xoay.
