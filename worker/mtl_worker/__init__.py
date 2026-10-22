"""Worker pull-only: claim job qua HTTP (fencing), chạy mtl_pipeline, upload output qua presigned PUT, complete."""

# Tăng khi đổi hành vi pipeline ảnh hưởng kết quả (input_rev) hoặc khi payload có trường mới worker cũ không hiểu
# (schema additionalProperties: false). API từ chối worker < MIN_PIPELINE_VERSION (426).
# 0.4.1: settings.narration_font.
PIPELINE_VERSION = "0.4.1"
