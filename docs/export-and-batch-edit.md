# Xuất chương + sửa hàng loạt (find/replace, áp glossary)

Trên UI (màn chương, xem [editor.md](./editor.md)): **Xuất** là drawer phải (`features/chapter/export-drawer.tsx`; mở
bằng nút chính "Xuất", menu phụ hoặc `?drawer=export`; cảnh báo "Trước khi xuất", chọn định dạng, tải qua 302 bên
dưới). **Tìm / Thay** và **Áp glossary** là tab của bảng dưới (cùng tab Bản dịch), không còn hộp thoại modal; hai tab
chỉ dùng được khi chương đã dịch xong. Trước khi gọi `apply` UI lưu hết sửa chưa lưu (`beforeWrite`). API bên dưới
không đổi.

## Xuất chương (`chapter.export`)

Render phía server bằng chính `worker/mtl_pipeline/render.py` (một renderer cho auto-typeset và export, hợp đồng
[typeset-layout-contract.md](./typeset-layout-contract.md)): nền = `clean/{pages.clean_rev}.png`, vẽ `text_boxes`
(bỏ `hidden`). Box thiếu `lines` mà có `text` → `render.ensure_lines` ngắt dòng giống hệt `layoutBox` của editor
(`apps/web/src/features/editor/measure.ts`); editor cũng vẽ theo cách đó khi gặp box như vậy.

| API | Ghi chú |
|---|---|
| `POST /api/w/:ws/chapters/:id/export` | `{format: png_zip\|cbz, layout: original_slices\|pages, quality=90, include_untranslated=false}` → 202 `{job, created}`; chưa có page → 409 `no_pages`; chương đang ingest/xử lý → 409 `chapter_busy`; bấm lại khi job cũ còn chạy và chương chưa đổi → trả job cũ |
| `GET …/chapters/:id/exports` | ≤ 10 export gần nhất (7 ngày) |
| `GET /api/w/:ws/exports/:jobId` | trạng thái, `bytes`, `expires_at`, `download_url` |
| `GET /api/w/:ws/exports/:jobId/download` | 302 → presigned GET 5' + `Content-Disposition: attachment`; chưa xong 409; quá 7 ngày/đã xoá 410; job của workspace khác 404 |

- **Inputs** (chốt lúc claim, `ExportInputs`): page theo `ord`, `translated` = page `ready` + có ảnh sạch (page khác
  dùng ảnh gốc, không vẽ chữ; bị bỏ khi `include_untranslated=false`), `state`, `source_map`, slice gốc theo `ord`.
- **Layout**: `pages` = `{ord+1:03}` mỗi page; `original_slices` = cắt lại đúng slice upload gốc theo `source_map`,
  ghép theo cửa sổ trượt (render từng page, dán vào buffer slice đích, slice đủ hàng thì ghi ra zip) — không giữ cả
  strip trong RAM. Slice có đoạn thuộc page chưa dịch bị bỏ khi `include_untranslated=false`.
- **Tải nền**: worker tải hết ảnh nền ra thư mục tạm trước khi render (URL ký 15', render chương dài có thể lâu hơn).
  Tên file `{ord+1}` đệm ≥ 3 chữ số (đủ chữ số khi > 999 ảnh).
- **Ảnh**: `png_zip` luôn PNG; `cbz` quality 100 → PNG, < 100 → JPEG. Zip ghi ra file tạm (entry STORED), CBZ có
  `ComicInfo.xml` tối thiểu.
- **Output**: `ws/{ws}/ch/{ch}/export/{jobId}.{zip|cbz}`. Presigned PUT mang `headers` đã ký (`content-type` +
  `x-amz-tagging: mtl-kind=export`) — worker gửi đúng các header này, xin URL mới ngay trước khi upload (TTL ≤ 120s).
  Complete chỉ nhận đúng key cấp lúc claim, `bytes` lấy từ HEAD object.
- **Xoá sau 7 ngày**: lifecycle MinIO lọc theo tag (`minio-init` trong `infra/docker-compose.dev.yml`,
  `mc ilm import`); production phải cấu hình rule tương đương trên bucket.

## Find/replace và áp glossary (tab Tìm / Thay, Áp glossary)

Chữ thường (không regex), phạm vi trong 1 chương, thay trong `region.translation` và `text_box.text`; box bị đổi có
`lines: []` (renderer ngắt lại).

| API (`/api/w/:ws/chapters/:id/…`) | Ghi chú |
|---|---|
| `find-replace/preview` `{find, replace, case_sensitive}` | không cần khoá; → `{matches, total, truncated, versions}` |
| `find-replace/apply` `{…, versions}` | cần khoá chương (423); page đổi sau preview → 409 `preview_stale` |
| `find-replace/undo` `{batch_id}` | cần khoá; page đã bị sửa tiếp (hoặc đã hoàn tác) → 409 `undo_conflict` |
| `glossary-apply/preview` `{rules: [{source_term, from}]}` | target lấy từ glossary đã gộp (entry series đè entry chung **cùng cặp** nguồn→đích của series; term chỉ có ở cặp khác → 400 `unknown_terms`); chỉ thay trong vùng có `source_text` chứa term nguồn và box gắn vùng đó |
| `glossary-apply/apply` `{rules, versions}` | như find-replace; hoàn tác qua `find-replace/undo` |

Apply = 1 transaction: mỗi page ghi bản cũ vào `page_state_history` với chung `batch_id`, version +1,
`state_origin = user` (job AI sau đó không ghi đè, xem luật AI-không-ghi-đè). Undo khôi phục khi version hiện tại =
version lúc áp + 1. History giữ 50 bản/page — batch quá cũ có thể không còn (404).

## Glossary

Hai cấp:

- **Glossary chung** (`series_id` null) chia theo **cặp nguồn→đích** (`source_lang`, `target_lang`). Series chỉ nhận
  entry chung có đúng cặp `(series.source_lang, series.target_lang)` — khi dịch (`settings.glossary` của
  `chapter.translate`), khi áp glossary và ở mục kế thừa của tab Glossary. Không có entry "áp mọi cặp".
- **Glossary riêng series** không gắn cặp (`source_lang`/`target_lang` null), vẫn áp khi series đổi ngôn ngữ và đè
  entry chung trùng `source_term`. Form Cài đặt hiện cảnh báo (không chặn lưu) khi đổi nguồn/đích mà series có glossary
  riêng.

Bất biến "entry chung có cặp, entry series không" do **API** đảm bảo (zod + đường ghi duy nhất), DB không có CHECK
(bản API cũ trong cửa sổ rollback vẫn ghi được). Entry chung cặp null (chỉ có thể do bản API cũ ghi) không khớp cặp nào
→ bị bỏ qua khi dịch; sửa tay bằng SQL nếu cần.

| API (`/api/w/:ws/…`) | Ghi chú |
|---|---|
| `glossary?source_lang=&target_lang=` (GET/POST) | glossary chung của một cặp; thiếu/sai cặp → 400 `invalid_query` |
| `glossary/csv?source_lang=&target_lang=` (GET/POST) | CSV vẫn 4 cột, cặp lấy từ query; `replace` chỉ xoá entry của cặp đó; file `glossary-workspace-<src>-<tgt>.csv` |
| `series/:id/glossary[/csv]` | glossary riêng series; `inherited` = entry chung đúng cặp của series |
| `glossary/:entryId` (PATCH/DELETE) | phạm vi (series hoặc cặp) lấy từ entry, không đổi được qua PATCH |

Entry trả về có `source_lang`, `target_lang` (null với entry series). Web: `/w/$ws/glossary?src=&tgt=` (mặc định Hàn →
Việt), 2 select chọn cặp, đổi cặp thay URL (không thêm history).

Một term mỗi phạm vi: ràng buộc `UNIQUE NULLS NOT DISTINCT (workspace_id, series_id, source_lang, target_lang,
source_term)` (migration 0006; 0002 xoá bản trùng cũ, giữ bản sửa gần nhất) — cùng term được có ở hai cặp khác nhau.
Request đua nhau → 409 `duplicate_term`. Sửa entry chung tăng `glossary_rev` **mọi** series của workspace (không lọc
theo cặp, tránh race với PATCH đổi ngôn ngữ series).

Migration 0006 chỉ thêm cột (rollback app không cần down DB): entry chung có sẵn được gán **ko→vi** (trước 0.4.0 API chỉ
cho ko→vi) — entry chung tạo sau khi deploy 0.4.0 cho cặp khác cũng bị gán ko→vi, sửa bằng xoá rồi thêm lại ở cặp đúng;
series khác ko→vi trong workspace có entry chung được tăng `glossary_rev` (để "Dịch lại" không dùng lại job cũ). Down
thủ công: `packages/db/migrations-down/0006_glossary_lang_pair.down.sql` (term trùng giữa các cặp chỉ giữ bản sửa gần
nhất; ưu tiên giữ bản ko→vi). Rollback **chỉ app** về bản trước 0006: bản cũ gộp entry chung mọi cặp (quay lại lỗi
ép chữ Việt vào bản dịch đích khác) và **nhập CSV "thay toàn bộ" ở glossary chung xoá entry của mọi cặp** — không dùng
chế độ đó tới khi deploy lại. Tab web mở từ trước deploy gọi route glossary chung không có cặp → 400 tới khi tải lại trang.

## Gate parity Konva ↔ render.py

`apps/web/e2e/typeset-parity.spec.ts` vẽ 10 page_state golden bằng code editor thật (`drawBoxText`) và so bbox mực
từng dòng với fixture `apps/web/e2e/fixtures/typeset-parity.json` (sinh từ render.py): lệch ≤ 1px. Đổi render.py /
measure.ts / font → `node scripts/typeset-parity.ts` (sinh lại fixture; `--check` để so) rồi
`pnpm --filter @mtl/web e2e typeset-parity`. Gồm 8 box thiếu `lines` (ngắt dòng + cỡ auto-fit phải trùng); chưa gồm box xoay.
