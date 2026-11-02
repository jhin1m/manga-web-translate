# OCR vùng tự xoá chữ gốc

Status: done (chưa commit) · Created: 2026-11-02 · Implemented: 2026-11-02 · Branch: main

## Vấn đề
OCR vùng (R) chỉ OCR + dịch + chèn khối chữ; chữ gốc vẫn nằm trên ảnh sạch. Người dùng phải dùng thêm Mask (B) để xoá
→ 2 thao tác rời, khó hiểu. Mục tiêu: kéo khung + xác nhận = đọc, dịch **và** xoá chữ gốc trong khung.

## Quyết định
- **Tái dùng `page.reinpaint`**, thêm chế độ mask tự động theo bbox (thay vì nhồi inpaint vào `page.ocr_region`):
  đường ghi `clean_rev` + kiểm `base_clean_rev` đã có; OCR và xoá chạy song song → khối chữ hiện ngay, ảnh sạch cập nhật sau.
- **Mask = nét chữ trong khung, không phải cả khung** (khung hay đè lên hình vẽ → xoá cả khung làm nhoè tranh):
  CTD `predict` trên cửa sổ quanh bbox + `build_text_mask` (fallback polarity có sẵn), cắt theo bbox + dilation.
  Tính trên ảnh sạch hiện tại (chữ sót vẫn còn ở đó) → không cần thêm input.
- **SFX vẫn xoá**: pipeline tự động cố ý giữ SFX (`restore_sfx`); người dùng tự kéo khung = ý định rõ.
- **"Dịch lại khối" không xoá** (vùng đó pipeline đã xử lý).
- ~~OCR và xoá chạy song song~~ → xoá sau khi khối dịch chèn xong (xem "Sau review").
- Panel OCR có checkbox "Xoá chữ gốc trong khung" (mặc định bật, nhớ theo trình duyệt) — tắt khi chỉ muốn dịch kèm.
- Nhiều khung liên tiếp: web **xếp hàng các lần xoá** (chờ lần trước xong, lấy `clean_rev` mới) → không dính 409
  `clean_rev_changed`.
- Nâng worker `PIPELINE_VERSION` + API `MIN_PIPELINE_VERSION` 0.8.0 → 0.9.0 (payload reinpaint mới; worker cũ từ chối schema).
  API `PIPELINE_VERSION` (muối input_rev) **giữ 0.4.0** — tăng là chạy lại mọi job, tốn AI.

## Phases
| # | Phase | File | Status |
|---|---|---|---|
| 1 | Schema chung + API | [phase-01-schema-api.md](phase-01-schema-api.md) | done |
| 2 | Worker: mask chữ tự động theo bbox | [phase-02-worker-auto-mask.md](phase-02-worker-auto-mask.md) | done |
| 3 | Web: xoá sau xác nhận OCR, xếp hàng, làm mới ảnh | [phase-03-web-chain.md](phase-03-web-chain.md) | done |
| 4 | Kiểm thử + docs | [phase-04-verify-docs.md](phase-04-verify-docs.md) | done |

Phụ thuộc: 1 → 2 (worker đọc json-schema) → 3 → 4. Ước lượng: 2–3 giờ.

## Tiêu chí xong
- Kéo khung quanh chữ sót (kể cả SFX trên tranh) → xác nhận → khối chữ dịch xuất hiện, vài giây sau ảnh sạch không
  còn chữ gốc; hình vẽ ngoài nét chữ không bị nhoè rõ.
- 3 khung kéo liên tiếp nhanh → cả 3 đều được xoá, không lỗi 409.
- Tắt checkbox → hành vi cũ (chỉ OCR + dịch).
- Mask (B) thủ công chạy như cũ. Test worker/API/web + e2e pass; json-schema đã emit.

## Điều chỉnh khi làm (đo trên dữ liệu thật: arm-boy-rivalry trang 2, SFX 하아)
- Cửa sổ CTD = dải cả bề ngang page, cao 1.25 × ngang (đúng tỉ lệ tile lúc prepare), không phải cửa sổ ~512px: cửa sổ nhỏ
  bị phóng lên 1024 → pred yếu (6% so với 20% phủ khung), mask chỉ bắt được "아".
- Gộp thêm pred > 64 trong khung: refine_mask bỏ vòng "ㅇ" (pred ~150) → vẫn còn sót.
- **Bỏ fallback cực tính** cho khung tự xoá: khung chỉ có tóc → fallback xoá 10% khung (nét viền). Ảnh sạch không hoàn tác
  → model không thấy chữ = job fail "Không thấy chữ trong khung… tô Mask (B)".

## Sau review (reports/code-review-261102-2110-ocr-region-auto-erase-report.md, 7/10)
- H1 sửa: complete `page.reinpaint` chỉ đổi `clean_rev` khi vẫn = `base_clean_rev`, không thì job failed
  `clean_rev_changed` (2 lần xoá song song không ghi đè nhau). Có test API.
- M1/M2 (tự quyết, đảo được): **bỏ chạy song song** — chỉ xoá sau khi OCR xong + khối dịch đã chèn (OCR lỗi/huỷ → chữ gốc
  giữ nguyên); hàng xoá theo từng page, sống tới khi rời chương, đổi trang / "Huỷ OCR" không bỏ lần xoá đã xếp.
- M3 sửa: tiến độ chương bỏ job thao tác editor đã kết thúc → lần xoá lỗi không thành "trang lỗi, dịch lại".
- M4: e2e kiểm "Dịch lại khối" không xoá + chưa xoá trước khi OCR xong. Chưa có test hook React (repo không có RTL).
- L1 (enqueue kiểm đúng 1 nguồn mask), L2 (gộp pred lỏng chỉ khi model thấy chữ rõ), L3 (`TILE_H_RATIO` dùng chung
  `detect.py`) sửa. L4 (worker không chạy → "Đang xoá chữ gốc…" treo, không có ghi chú chờ) để sau.

## Rủi ro
- Xoá ảnh sạch **không hoàn tác được** (giống Mask hiện tại; clean_rev chỉ tiến). Mask tự động sai → phải tô Mask
  sửa tay. Câu hỏi mở bên dưới.
- CTD bỏ sót nét chữ mảnh/nghệ thuật → fallback polarity; có thể vẫn sót → người dùng dùng Mask bổ sung.

## Câu hỏi mở
- Có cần nút "Khôi phục ảnh sạch trước đó" (quay về clean_rev cũ) không? Ngoài phạm vi plan này.
