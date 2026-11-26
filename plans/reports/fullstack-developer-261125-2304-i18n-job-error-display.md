# Báo cáo: nhãn lỗi job theo locale (xuất, cắt trang, OCR vùng, xoá chữ)

Trạng thái: hoàn thành. Typecheck web/api, test web, pytest worker, Biome và ruff trên file đã đổi đều xanh. 40/40 e2e
liên quan xanh. Chưa commit hay stage.

## Web: câu chính lấy theo `error_class`

| Chỗ | Trước | Sau |
|---|---|---|
| Lỗi xuất (`export-options.ts` `exportPhase`, `export-panel.tsx`, gồm nút chính và dòng lịch sử) | `x.error` thô | `exportFailureText(x)` trả "Xuất không thành công: {nhãn}." Lỗi thô chuyển vào `title` (`phase.detail`) |
| Cắt trang lỗi (`chapter-workspace.tsx`) | `ingestFailedWithError {error: job.error}` | `{error: jobErrorLabel(job)}`, lỗi thô để ở `title` của dòng |
| OCR vùng (`OcrSelect.tsx` → `ocr-wait.ts` `ocrFailureText`) | `done.error` thô | Thiếu model hoặc hết hạn mức AI dùng `describeJobError`. Các lỗi khác hiện "Quét chữ vùng thất bại: {nhãn}" |
| Xoá chữ: khung OCR (`erase-queue.ts`) và vùng Mask (`MaskToolBar.tsx`) | lỗi thô | `reinpaintFailureText`: hai mã tiền tố `no_text_in_box:` và `clean_rev_changed:` ra câu hướng dẫn, các lỗi khác ra "Xoá chữ gốc thất bại: {nhãn}" |

- Nhãn đều lấy từ `jobErrorLabel` trong `job-error.ts`, không có helper nhãn mới. Hai hàm `ocrFailureText` và
  `reinpaintFailureText` chỉ ghép câu riêng của từng thao tác với nhãn có sẵn. Mỗi hàm được tái dùng ở hai nơi.
- Mã tiền tố `clean_rev_changed:` do API ghi vào `jobs.error` với `error_class` là `invalid_input`. Nếu không xử lý
  riêng, người dùng sẽ thấy nhãn "ảnh lỗi hoặc vượt giới hạn", và nhãn này sai. Vì vậy mã này đi theo cách đã làm với
  `no_text_in_box:`. Câu vi giữ nguyên nghĩa của câu cũ.
- API `exportView` (`apps/api/src/routes/export.ts`) có thêm trường `error_class`, và kiểu `ExportView` ở web cũng
  thêm trường này. Trước đây web không có `error_class` của lượt xuất nên không chọn được nhãn.
- Key mới vi và en: `chapter.exportOptions.failedCause`, `editor.eraseQueue.failedCause`,
  `editor.eraseQueue.cleanRevChanged`, `editor.ocrSelect.failedCause`. Key `editor.maskToolBar.cleanFailed` không còn
  dùng nên đã bỏ.
- Không đổi selector e2e.

## Worker

Câu của `ImageRejected` (`worker/mtl_pipeline/images.py`) chuyển sang tiếng Anh kỹ thuật. Runner đã map
`ImageRejected` sang `invalid_input` (`runner.py:338`, đã có test `test_invalid_image_is_invalid_input`). Web đã có
nhãn vi/en `chapter.jobError.class.invalid_input`, nên không cần thêm key.

## Test cũ đổi assert (đổi theo hành vi mới, không làm yếu)

- `export-options.test.ts`: trước đây khoá `error: "hết dung lượng"` (giá trị thô). Giờ test kiểm câu nhãn khi có
  `error_class`, khi chỉ có lỗi thô (nhãn "lỗi hệ thống"), và khi không có lỗi nào. Test cũng kiểm `detail` giữ đúng
  lỗi thô.
- `erase-queue.test.ts`: trước đây job hỏng chung chung trả lỗi thô. Giờ test kiểm "Xoá chữ gốc thất bại: lỗi hệ
  thống". Thêm test cho `clean_rev_changed:` và cho `reinpaintFailureText`.
- `ocr-wait.test.ts`: thêm test cho `ocrFailureText`. Các trường hợp gồm có nhãn, thiếu model, hết hạn mức (câu chính
  không chứa lỗi thô) và câu chung.
- `test_image_limits.py`: chuỗi `match` đổi sang câu tiếng Anh mới.

## Grep chứng minh

`grep -rnE "(done|job|j|x|ingestFailed|phase)\??\.(error|detail)\b"` trên `apps/web/src`, bỏ test và `error_class`,
chỉ còn các loại sau:

- Thuộc tính `title`: `export-panel.tsx:252,379` và `chapter-workspace.tsx:1599`.
- Trường `detail` hoặc `raw` dành cho "Chi tiết kỹ thuật": `export-options.ts:140`, `proofread-panel.tsx:62` và
  `job-error.ts:141,167`.
- Kiểm tiền tố mã: `job-error.ts:45,83`, `ocr-wait.ts:21,41,70` và `erase-queue.ts:44`.
- `activity-drawer.tsx:299`: dòng này hiện nhãn trước, lỗi thô nối phía sau, và nằm trong khối `<details>` "Chi tiết"
  (vùng kỹ thuật). Phần này giữ nguyên.

## Lệnh kiểm (tuần tự, `nice`)

| Lệnh | Kết quả |
|---|---|
| `pnpm --filter @mtl/web typecheck` / `@mtl/api typecheck` | xanh |
| `pnpm --filter @mtl/web test` | 65 file, 619 xanh |
| `vitest run test/export.test.ts` (api) | 12 xanh |
| `cd worker && uv run pytest -q` | 445 xanh; `ruff check` và `ruff format --check` sạch |
| `biome check` (14 file đã đổi) | sạch |
| `playwright test chapter-tools editor rail-text-export trim-source trim-auto-drop trim-learn-band --workers=1` | 40/40 xanh |

Playwright tự bật rồi tắt :8797 và :5181. Sau khi chạy, `lsof` không còn process nào nghe ở hai cổng này. Postgres
:5442 để nguyên.

## Câu hỏi chưa giải quyết

- Lỗi thô của OCR vùng và xoá chữ không còn hiện ở đâu trên giao diện. Lý do là dải lỗi của editor chỉ nhận chuỗi, và
  hai loại job này không có trong danh sách "Hoạt động". Lỗi vẫn nằm trong `jobs.error` và log worker. Nếu cần xem
  ngay trên giao diện thì phải nối thêm `title` cho dải lỗi, đây là một việc riêng.
