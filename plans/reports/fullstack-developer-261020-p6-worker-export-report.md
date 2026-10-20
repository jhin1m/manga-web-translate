# Báo cáo worker chapter.export (Phase 6)

## File
- Mới: `worker/mtl_worker/export.py`, `worker/tests/test_render_lines.py`, `worker/tests/test_export_slices.py`, `worker/tests/reference/render_lines.png`
- Sửa: `worker/mtl_pipeline/render.py` (ensure_lines, text_box_from_shared, render_page_state, SliceAssembler, SliceMapError), `worker/mtl_worker/client.py` (upload_file + Protocol), `handlers.py` (đăng ký), `runner.py` (DEFERRED_TYPES = {}), `tests/test_worker_runner.py` (FakeClient.upload_file)
- main.py không đổi: pipeline ONNX chỉ nạp khi có ingest/prepare/reinpaint/translate; export không vào LLM_TYPES nên chạy được với --no-llm.

## Quyết định
- Golden đặt ở `tests/reference/` (không phải `tests/golden/`): `.gitignore` gốc có `golden/` → file sẽ không bao giờ được commit. Thiếu file → test fail; `UPDATE_GOLDEN=1` để sinh lại. Dung sai: lệch > 2 mức xám trên ≤ 0.5% pixel.
- `ensure_lines(box, auto_fit)` tách đoạn theo `\n` rồi tái dùng `typeset.wrap_words/hard_wrap/block_height/MIN/MAX_SIZE` (import lười để tránh vòng). Vòng binary search cỡ chữ lặp lại ~8 dòng so với `fit_text` vì typeset.py ngoài danh sách sửa; test khẳng định kết quả == `fit_text` khi không có `\n`. Việc gộp sau: cho `fit_text` nhận hàm wrap.
- Chỉ validate chặt: kích thước nền phải khớp width/height khai báo; slice trên các page khác bề rộng; source trong source_map phải có trong `sources`; ord page/source trùng; không còn ảnh nào để xuất → `invalid_input`.
- Chiều cao buffer slice = max(src_y + h) (bằng tổng h khi source_map phủ liên tục như ingest sinh ra).
- Page cần tải/render chỉ khi còn ít nhất 1 slice được giữ (layout slices) hoặc translated/include (layout pages).
- Fill 8 hex (có alpha) chỉ lấy RGB (render.py hiện không xử lý alpha) — giữ nguyên hành vi.
- Upload: presign mới ngay trước PUT, header đúng nguyên văn từ presign (`headers`, mặc định content-type image/png); 403 → presign lại thử 1 lần; key presign phải trùng key lúc claim.
- ZIP ghi file tạm trong TemporaryDirectory (tự xoá), ZIP_STORED; CBZ có ComicInfo.xml đầu (PageCount = số ảnh thực xuất).

## Kiểm
- ruff check xanh; mypy xanh (50 file); pytest 120 passed, 2 skipped.
- `ruff format --check .` báo lỗi ở `worker/scripts/typeset_parity.py` (file của người khác, đang untracked, không thuộc phần mình); mtl_pipeline/mtl_worker/tests đều sạch.

## Số đo (máy dev macOS, nền trơn PNG, 6 box/page, 100 page 800x4500, fake client)
- layout pages, png_zip: 4.3s, maxrss 177MB, zip 12.8MB
- layout original_slices, cbz q85: 3.1s, maxrss 246MB (gồm cả bản zip 55MB giữ trong RAM của fake client)
- Ảnh thật (nhiều chi tiết) sẽ nặng hơn do giải mã/encode PNG; RAM theo cửa sổ trượt không phụ thuộc số page.

## Còn lại
- Chưa chạy thật với API/MinIO (người khác làm). `x-amz-tagging` nằm trong chữ ký nên được gửi nguyên văn.
