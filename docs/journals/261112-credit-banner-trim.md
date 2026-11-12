# Cắt banner credit ở mép ảnh gốc: dấu dải bị lẫn pixel ngoài dải, và e2e xanh giả

**Date**: 2026-11-12
**Severity**: High (bắt được trước khi commit; nếu lọt thì tự cắt gần như không bao giờ khớp trên chương thật)
**Component**: worker (`mtl_pipeline/ingest.py`, 0.12.0), API (`claim-inputs.ts`, `series-skip-images`, migration 0027), shared (`dhash.ts`, `worker-protocol.ts`), web (`features/upload/image-fingerprint.ts`)
**Status**: Xong trên `feat/trim-credit-banner`, chưa phát hành. Gate xanh trừ e2e 118/119 (`block-panel.spec.ts:317`, đỏ cả trên `main`). Còn mục kiểm tay bên dưới.

## Đã làm gì

Plan `plans/261112-1505-credit-banner-trim/`, 4 phase code + 1 phase docs. Người dùng cắt mép trên/dưới ảnh gốc, chọn "Luôn cắt" thì dải được học theo series (dHash), chương sau thả vào sẽ tự cắt nếu khớp.

## Phần đau

**1. Dấu dải lẫn pixel ngoài dải (review phase 4, 5/10).** `dhashOfRegion` gọi `drawImage(bmp, sx, sy, sw, sh, 0,0,9,8)` với `imageSmoothingQuality = "high"`. Chromium thu nhỏ qua mipmap của *cả bitmap*, nên dải 720x100 hút cả vùng tranh phía trên. Cùng một banner đặt dưới tranh khác cho khoảng cách Hamming 8-18 bit (PNG lossless vẫn 8-13), ngưỡng là 6. Tự cắt gần như không bao giờ bắn.

Điều khó chịu nhất: e2e `trim-auto-drop` vẫn xanh vì ảnh học (ch1 `p2`) và ảnh đích (ch3 `p3`) sinh từ cùng hàm `banner` cùng kích thước, tức pixel giống hệt. Test khớp mờ mà cho đầu vào giống hệt thì chỉ chứng minh được hàm băm tự khớp với chính nó.

Sửa (`af4bf70`): `dhashOfBand` chép dải 1:1 sang canvas riêng rồi `grayGridFromRgba` (thuần JS, trung bình theo diện tích, mép ô lẻ có trọng số) ra lưới 9x8. Đo lại trong Chromium: tranh khác 0, lề 40/150 px 0, bề rộng 800 và 690 đều 0, ảnh không có banner 29 (không khớp). E2E giờ học ở chương này, khớp chương khác có tranh phía trên khác, và 720 sang 800.

**2. Export `original_slices` dựng lại slice từ pages.** Cắt ở worker sau khi ghép thì lệch. Phải cắt ảnh trong worker *trước* `build_pages`, `src_y` tính theo ảnh đã cắt, kẹp tối thiểu 1 px. Có `test_export_slices.py`. Worker 0.12.0, API `MIN_PIPELINE_VERSION` 0.12.0 (worker cũ nhận 426).

**3. Trường nullable nhưng bắt buộc làm hỏng rollback (P1, M1).** `trim` khai báo `.nullable()` không `.optional()`, nên schema phát ra liệt kê `trim` là required. Deploy worker 0.12.0 rồi rollback API: API cũ vẫn nhận worker (MIN 0.10.0), không gửi `trim`, worker ném `ContractError: sources/0: 'trim' is a required property`, mọi ingest hỏng. Câu "cột nullable, bỏ code đọc là đủ" trong plan là sai. Sửa: `.nullable().optional()`, chạy lại `pnpm schema:emit`, thêm test nguồn không có `trim`. Thêm luôn `migrations-down/0027` và `0028` (trước đó thiếu, các migration 0019–0026 đều có).

**4. Học dải (P3).** Học từng mép trong try/catch riêng; `band_px` bắt buộc, lệch với trim đã lưu thì 409 `trim_changed`; dải dưới `MIN_BAND_PX` (8, = `DHASH_H`) thì 409 `band_too_small`.

## Bài học

- E2E cho so khớp mờ phải dùng đầu vào *không giống hệt*: tranh khác, bề rộng khác, ảnh âm tính. Đầu vào giống hệt cho kết quả xanh vô nghĩa.
- Canvas `drawImage` với sub-rect không cắt trước khi thu nhỏ. Muốn hash một vùng thì chép 1:1 ra canvas riêng trước.
- Trường mới trong hợp đồng worker phải `optional` nếu API cũ còn chạy được cạnh worker mới; "nullable" không đủ.
- Đổi cách tính dấu dải làm dải học trước `af4bf70` vô hiệu. Chưa phát hành nên chỉ dev/QA phải học lại.

## Việc còn lại

- Kiểm tay trước khi phát hành: Safari/Firefox (kéo thanh, dấu dải), màn cảm ứng thật, webtoon 720x15000, chương thật có banner (cắt, Luôn cắt, chương sau tự cắt, xuất 2 kiểu, mở file), CORS MinIO bản hosted.
- Một lần phát hành duy nhất kèm nâng worker lên 0.12.0, worker trước API; thêm `docs/releases/` khi chốt số rc. Ghi chú đã có ở `docs/deployment-guide.md` mục 0.12.0.
- `block-panel.spec.ts:317` đỏ 3/3 trên `main` (d6c6ebb), chưa ai điều tra. Đã lặp lại ở nhiều đợt, nên sớm xử lý.
