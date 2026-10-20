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
| `glossary-apply/preview` `{rules: [{source_term, from}]}` | target lấy từ glossary đã gộp (series đè workspace); chỉ thay trong vùng có `source_text` chứa term nguồn và box gắn vùng đó |
| `glossary-apply/apply` `{rules, versions}` | như find-replace; hoàn tác qua `find-replace/undo` |

Apply = 1 transaction: mỗi page ghi bản cũ vào `page_state_history` với chung `batch_id`, version +1,
`state_origin = user` (job AI sau đó không ghi đè, xem luật AI-không-ghi-đè). Undo khôi phục khi version hiện tại =
version lúc áp + 1. History giữ 50 bản/page — batch quá cũ có thể không còn (404).

## Glossary

Một term mỗi phạm vi: ràng buộc `UNIQUE NULLS NOT DISTINCT (workspace_id, series_id, source_term)` (migration 0002
xoá bản trùng cũ, giữ bản sửa gần nhất). Request đua nhau → 409 `duplicate_term`.

## Gate parity Konva ↔ render.py

`apps/web/e2e/typeset-parity.spec.ts` vẽ 10 page_state golden bằng code editor thật (`drawBoxText`) và so bbox mực
từng dòng với fixture `apps/web/e2e/fixtures/typeset-parity.json` (sinh từ render.py): lệch ≤ 1px. Đổi render.py /
measure.ts / font → `node scripts/typeset-parity.ts` (sinh lại fixture; `--check` để so) rồi
`pnpm --filter @mtl/web e2e typeset-parity`. Gồm 8 box thiếu `lines` (ngắt dòng + cỡ auto-fit phải trùng); chưa gồm box xoay.
