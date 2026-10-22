"""Worker pull-only: claim job qua HTTP (fencing), chạy mtl_pipeline, upload output qua presigned PUT, complete."""

# Tăng khi đổi hành vi pipeline ảnh hưởng kết quả (input_rev). API từ chối worker < MIN_PIPELINE_VERSION (426).
PIPELINE_VERSION = "0.4.0"
