"""Worker pull-only: claim job qua HTTP (fencing), chạy mtl_pipeline, upload output qua presigned PUT, complete."""

# Tăng khi đổi hành vi pipeline ảnh hưởng kết quả (input_rev) hoặc khi payload có trường mới worker cũ không hiểu
# (schema additionalProperties: false). API từ chối worker < MIN_PIPELINE_VERSION (426).
# 0.4.1: settings.narration_font.
# 0.4.2: export pages[].skipped.
# 0.5.0: prepare ghi region.text_color/outline_color; typeset giữ màu chữ gốc khi đủ tương phản. Worker < 0.5.0 không
#        đọc nổi region có màu (schema strict) → không rollback xuống dưới mốc này sau khi đã prepare.
# 0.5.1: translate/export inputs.fonts (font tuỳ chỉnh `custom-*`).
# 0.6.0: payload có cài đặt pipeline của người dùng (prepare.pipeline, reinpaint.inpaint, ocr_region.ocr_engine);
#        detector CTD, LaMa manga, OCR local (manga-ocr, PaddleOCR); job chapter.proofread.
# 0.7.0: chapter.translate theo lô — payload/result `carry` (notes + tên nhân vật chuyền giữa các job lô).
# 0.7.1: TextBox.valign — export căn giữa dọc. Worker < 0.7.1 fail job export (schema input additionalProperties: false
#        không nhận trường valign) → không rollback worker xuống dưới mốc này khi đã có box mới.
# 0.8.0: region.style (normal|thought|note) do LLM dịch gắn; settings.thought_font/note_font. Worker < 0.8.0 fail job
#        đọc state có region style (schema strict) → không rollback worker xuống dưới mốc này sau khi đã dịch.
# 0.9.0: page.reinpaint.auto_text_bbox — OCR vùng tự xoá chữ gốc (mask nét chữ trong khung tính ở worker); payload
#        không còn user_mask_key/offset → worker < 0.9.0 fail schema.
# 0.10.0: claim `llm` (cấu hình provider + key theo slot ocr/translate/proofread) + payload `llm`; proofread
#        `model_tier` optional. Worker < 0.10.0 fail schema claim-response/job-payload (strict).
PIPELINE_VERSION = "0.10.0"
