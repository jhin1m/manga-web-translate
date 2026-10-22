# Brainstorm: rail ảnh gốc trước Bước 1, xoá ảnh/trang, tự bỏ credit + watermark

Ngày: 2026-10-22 · Trạng thái: user đã duyệt thiết kế

## Yêu cầu
1. Rail trái hiện từng ảnh ngay khi upload, trước khi bấm "Bước 1".
2. Cho xoá ảnh/trang trước khi bắt đầu và sau khi xong (sau Bước 1 / Bước 2).
3. Tự bỏ qua credit, watermark.

## Bối cảnh code (scout)
- Trước Bước 1 chưa có page — chỉ `source_files`. Bước 1 (`worker/mtl_pipeline/ingest.py`) ghép slice cùng width thành strip rồi cắt theo bóng thoại (96 slice → 33 page); `page_format=pages` thì 1 file = 1 page.
- Ảnh gốc chương nháp hiện dạng lưới ở canvas (`apps/web/src/features/chapter/source-preview.tsx`); rail (`page-rail.tsx`) chỉ có page.
- Commit (`apps/api/src/routes/chapters.ts:222`) đã xoá source_file bị loại; ingest sort theo `ord` → ord thủng không sao.
- `resumeChapter` (`upload-manager.ts`) khớp số lượng + bytes theo thứ tự với `source_files` → bị ảnh hưởng khi xoá ảnh.
- Page id tất định `uuid v5(chapter, "{ingest_rev}:{ord}")`; export `original_slices` cắt lại slice theo `source_map` → xoá cứng page làm hỏng export ("source_map thiếu đoạn").
- Đã có `is_sfx` (worker `pipeline.py`): vùng SFX không xoá/không dịch. Bước 1 inpaint mọi vùng chữ không phải SFX.
- Chưa có gì về credit/watermark. Credit mẫu rộng 4036px ≠ slice truyện → `group_slices` đã tách nhóm riêng.

## Quyết định user
| Câu hỏi | Chốt |
|---|---|
| Rail trước Bước 1 | Ảnh gốc ("Ảnh n") + bấm xem lớn giữa màn; bỏ lưới SourcePreview |
| Xoá sau xử lý | Ẩn, khôi phục được (không xoá cứng) |
| Loại rác | Ảnh credit nguyên tấm + watermark chữ trong trang |
| Nhận diện | Học theo series (hash), gợi ý theo kích thước, danh sách chữ bỏ qua; **AI phân loại để đợt sau** |
| Watermark khớp | Xoá sạch (Bước 1 đã inpaint), không dịch, không tạo box |
| Ảnh tự loại trước Bước 1 | Hiện mờ + nhãn "Credit · tự bỏ" + icon khôi phục |
| Kích hoạt học credit | Toast sau khi xoá: "Đã xoá ảnh n · Hoàn tác · Luôn bỏ ở series này" |

## Phương án đã cân nhắc
- **Xoá cứng** source_file/page: đơn giản DB nhưng không hoàn tác, phá export `original_slices`, không dùng chung cho tự loại → loại.
- **Soft skip thống nhất** (chọn): 1 khái niệm "bỏ qua" cho xoá tay + tự loại, hoàn tác được, export an toàn.
- **AI vision phân loại credit**: tốn tiền mỗi ảnh, có thể nhầm trang truyện, phải chạy job lúc upload (trái quyết định "upload xong không tự chạy") → hoãn; dùng thử hash vài chương rồi đánh giá.
- **Hash tính ở server** (job decode) vs **client** (chọn): client đã có Blob lúc thả, tính dHash ~ms/ảnh, gửi kèm `createChapter` → khớp ngay lúc tạo, rail hiện "tự bỏ" trước Bước 1, không thêm job.

## Thiết kế chốt

### Nguyên tắc: xoá = đánh dấu bỏ qua
- `source_files.skip`: `null | "user" | "credit"` — commit/ingest loại ảnh skip.
- `pages.skipped boolean` — Bước 2/dịch lại/export bỏ qua; rail lọc "Đã xoá (n)" để khôi phục.

### Phase 1 — Rail ảnh gốc trước Bước 1 + xoá ảnh
- `PageRail` chế độ "ảnh gốc" khi chương `draft` / `ingesting` / `partial_failed` chưa có page: thumbnail (Blob local hoặc URL ký), "Ảnh n", trạng thái tải từng file.
- Bấm → canvas hiện ảnh đó vừa khung; ←/→ chuyển ảnh. Thay lưới SourcePreview; upload status + drop zone giữ.
- Icon Xoá (theo pattern tối giản) → `PATCH /w/:ws/chapters/:id/source-files/:fileId {skip}`; chỉ khi chương chưa có page; check khoá. Toast Hoàn tác / Luôn bỏ ở series.
- Upload manager: xoá file đang tải → huỷ lượt tải đó; marker localStorage ghi ord đã xoá để resume vẫn khớp bộ file.

### Phase 2 — Ẩn trang sau Bước 1/2
- Icon Xoá ở rail → `PATCH /w/:ws/pages/:id {skipped}`; cần giữ khoá, chương settled.
- Rail ẩn + đánh số "Trang n" theo trang còn hiện; chapter counts/status bỏ page skipped.
- `translatePrepared` / retranslate / retry bỏ page skipped (đỡ chi phí).
- Export `pages`: bỏ, đánh số liên tục. `original_slices`: slice nằm trọn trong page skipped bị bỏ; slice vắt qua → phần thuộc page skipped dùng ảnh gốc.
- "Luôn bỏ ở series" từ page = học hash các slice nằm trọn trong page.

### Phase 3 — Tự bỏ ảnh credit
- Client tính dHash 64-bit (+ width/height) lúc thả, gửi trong `files[]` của `createChapter`; lưu `source_files.dhash`.
- Bảng mới `series_skip_images` (series_id, dhash, w/h, thumbnail nhỏ, created_by, created_at). Khớp: Hamming ≤ 6 và tỉ lệ khung lệch ≤ 5% → `skip="credit"` ngay khi tạo chương.
- Gợi ý kích thước (client, không tự xoá): ảnh trong 3 đầu/3 cuối, width lệch > 10% trung vị → nhãn "Có thể là credit".
- Cài đặt series: mục "Ảnh tự bỏ" (thumbnail + xoá).

### Phase 4 — Watermark chữ
- `series.ignore_text text[]` — substring, không phân biệt hoa thường, không regex.
- `isIgnoredText()` ở `@mtl/shared`; dùng ở `apps/api/src/jobs/claim-inputs.ts` (`chapter.translate`: không gửi LLM, không tạo box) + bảng văn bản (ẩn dòng).
- Không đụng worker: Bước 1 đã inpaint vùng đó → trang sạch. Thêm từ khoá sau Bước 1 vẫn có hiệu lực ở Bước 2.

### Thứ tự
P1 → P2 → P3 (cần cột skip + toast của P1). P4 độc lập, song song được.

## Ngoài phạm vi
AI phân loại credit; regex; áp watermark ngược cho chương đã dịch; logo watermark dạng hình; đổi thứ tự ảnh.

## Rủi ro
- dHash khớp nhầm 2 credit cùng template khác chữ → ngưỡng chặt + chỉ đánh dấu, khôi phục được.
- Credit cùng width trang truyện: nếu chỉ phát hiện sau Bước 1 thì đã dính vào page lớn → ẩn page mất cả phần truyện; cách xử lý = bỏ ảnh gốc + chạy lại Bước 1 (plan không tự động hoá).
- Watermark chữ quá nhỏ/mờ detector không bắt → vẫn còn trên ảnh.
- Resume upload sau khi xoá ảnh: phải test kỹ (marker + khớp bytes theo thứ tự bỏ ord đã xoá).
- Thêm migration (2–3 cột + 1 bảng) → cập nhật `@mtl/shared` schema/JSON Schema payload nếu export inputs đổi.

## Tiêu chí kiểm
- Thả 96 ảnh → rail hiện 96 "Ảnh n" ngay khi đang tải; bấm xem lớn; ←/→ chạy.
- Xoá ảnh trước Bước 1 → Bước 1 không ghép ảnh đó; Hoàn tác khôi phục; resume upload vẫn khớp.
- Ẩn trang sau Bước 1 → Bước 2 không dịch trang đó (job input không chứa); export `pages` + `original_slices` đều thành công.
- "Luôn bỏ ở series" ở ch.N → thả ch.N+1 có credit giống → hiện "Credit · tự bỏ" trước Bước 1.
- Từ khoá watermark "discord.gg" → vùng chứa không có trong bảng, không có box, ảnh sạch.
- `pnpm typecheck && pnpm lint && pnpm test`, e2e upload/full-flow, `cd worker && uv run pytest` (export) xanh.

## Câu hỏi còn mở
- Ngưỡng Hamming 6 / tỉ lệ 5% cần đo trên credit thật của vài series trước khi chốt.
- Thumbnail trong `series_skip_images`: lưu bytea trong DB (~5KB) hay object MinIO — chốt khi lập plan.
