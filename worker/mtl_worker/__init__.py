"""Worker pull-only: claim job qua HTTP (fencing), chạy mtl_pipeline, upload output qua presigned PUT, complete."""

# Tăng khi đổi hành vi pipeline ảnh hưởng kết quả (input_rev) hoặc khi payload có trường mới worker cũ không hiểu
# (schema additionalProperties: false). API từ chối worker < MIN_PIPELINE_VERSION (426).
# 0.4.1: settings.narration_font.
# 0.4.2: export pages[].skipped.
# 0.5.0: prepare ghi region.text_color/outline_color; typeset giữ màu chữ gốc khi đủ tương phản. Worker < 0.5.0 không
#        đọc nổi region có màu (schema strict) → không rollback xuống dưới mốc này sau khi đã prepare.
PIPELINE_VERSION = "0.5.0"
