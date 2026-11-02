# Phase 2 — Worker: mask chữ tự động theo bbox

## Files
- `worker/mtl_worker/handlers.py` — `handle_reinpaint`
- `worker/mtl_pipeline/textmask.py` — hàm mới `bbox_text_mask(img, masker, bbox, dilation)` (dùng `CtdMasker.predict`
  trên cửa sổ + `build_text_mask` với 1 Region `text_free`)
- `worker/mtl_worker/__init__.py` / chỗ khai báo PIPELINE_VERSION → 0.9.0
- Test: `worker/tests/test_handlers*.py`, `worker/tests/test_textmask*.py`

## Bước
1. `bbox_text_mask`: cửa sổ = bbox + lề (max cạnh, kẹp page) → `masker.predict(window)` → `build_text_mask(window,
   pred, [Region(bbox cục bộ)])` → dán về toạ độ page → giữ phần trong bbox + dilation (không tràn ra ngoài khung
   người kéo quá vài px).
2. `handle_reinpaint`: có `auto_text_bbox` → mask = `bbox_text_mask(clean, deps.pipeline.masker, …)`; ngược lại
   nhánh user mask như cũ. Mask rỗng → trả clean cũ? Không: upload lại clean (giữ hợp đồng có `clean_rev` mới) hoặc
   fail `invalid_input` "không thấy chữ trong khung" — chọn fail để web báo rõ, không tạo rev thừa.
3. Báo stage "detect" rồi "inpaint".
4. Nâng PIPELINE_VERSION 0.9.0 (khớp API).

## Test
- Ảnh tổng hợp: nền xám có hoạ tiết + chữ đen trong bbox → mask phủ chữ, không phủ quá bbox + dilation.
- bbox không có chữ → JobFailure invalid_input.
- Nhánh user mask cũ giữ nguyên kết quả (test hiện có).

## Rủi ro
CTD predict trên cửa sổ nhỏ có thể khác predict cả page (resize nội bộ) → cửa sổ tối thiểu ~ 512px cạnh ngắn.
