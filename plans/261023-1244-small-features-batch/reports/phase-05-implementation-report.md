# Báo cáo triển khai Phase 5: chữ bỏ qua (bỏ dấu cách, regex, áp ngược)

Trạng thái: hoàn thành. Chưa commit.

## Đã làm

**Shared** (`packages/shared/src/ignore-text.ts`)
- `parseIgnoreEntry`, `ignoreEntryError` (lý do lỗi tiếng Việt), `compileIgnoreList`, kiểu `IgnoreMatcher`. `isIgnoredText` và `isValidIgnoreEntry` giữ nguyên chữ ký (wrapper), thêm hàm mới thay vì đổi chữ ký nên không phải sửa nơi gọi.
- Mục thường: so khớp sau khi bỏ mọi khoảng trắng; độ dài 3–100 đo trên dạng đã bỏ khoảng trắng (đổi so với trước: `a   b` giờ không hợp lệ, test cũ đã cập nhật).
- Mục `/mẫu/`: regex cờ `iu`, chạy trên chữ đã chuẩn hoá. Từ chối: không biên dịch được, tổng dài > 100, giữa hai dấu `/` < 3 ký tự, khớp chuỗi rỗng (`/a*/`), lượng từ lồng nhau (bộ quét nhóm `(a+)+`, `(.*)*`, `((a+))+`, `(a|b+)*`…).
- `cleanIgnoreList` dedupe bỏ dấu cách (`discord.gg` và `discord . gg` là một).

**API**
- `claim-inputs.ts`: biên dịch 1 lần mỗi lần claim (`ignoreMatcherOf`); `withoutIgnored` export để test.
- `series.ts`: validation `ignore_text` dùng `ignoreEntryError` (400 kèm lý do).
- Tách lõi sửa hàng loạt ra `apps/api/src/lib/batch-edit.ts` (`chapterPages`, `previewPages`, `applyBatch`, `undoBatch` có chế độ `fail`/`skip`, `PageTransform` tổng quát). `find-replace.ts` chỉ còn phần quy tắc thay + route; hành vi và JSON trả về giữ nguyên (`replaced`, `pages`). Test find-replace/glossary-apply không sửa, xanh.
- Route mới `apps/api/src/routes/series-ignore-apply.ts` (đăng ký ở `app.ts`): `POST /w/:ws/series/:seriesId/ignore-apply/{preview,apply,undo}`; thuần `hideIgnored`.
  - Preview theo chương: số box, số trang, tối đa 3 mẫu `source_text`, `versions`; chương bị người khác giữ khoá (`locked`, kèm `holder_name`) hoặc có job hoạt động (`busy`) vào `skipped`.
  - Apply: mỗi chương lấy khoá riêng (nhả sau nếu trước đó không phải mình giữ), 1 transaction, chung một `batch_id`, history `origin = user`, version +1; chương đổi sau preview vào `skipped` với `changed`, không ảnh hưởng chương khác.
  - Undo: theo `batch_id`, trang đã đổi sau đó bị bỏ qua và báo (`changed`, kèm số trang), chương bị khoá `locked`; batch không còn → 410 `batch_not_found`.

**Web**
- `rows.ts`: `pageRows` nhận `IgnoreMatcher`, `buildRows` biên dịch 1 lần.
- `ignore-text-input.ts`: lỗi theo dòng lấy lý do từ shared.
- Component riêng `ignore-apply-section.tsx` (+ `ignore-apply-model.ts` và test) và hàm API ở `series/api.ts`; `series-settings-form.tsx` chỉ thêm import, đoạn hint và 1 phần tử `<IgnoreApplySection>` (hiện khi đã có danh sách lưu; nút bị vô hiệu kèm lời nhắc khi ô đang sửa chưa lưu).
- Thông báo kết quả hiển thị tại chỗ (`role="status"`): "Đã ẩn N box ở M chương · Hoàn tác" (+ "Bỏ qua: Chương X (lý do)"). Trang series chưa có hệ thống toast nên dùng dòng thông báo ngay dưới nút; không thêm hạ tầng toast mới (YAGNI).

**Docs/README**: `docs/job-queue-worker.md` (quy tắc khớp, regex), `docs/export-and-batch-edit.md` (mục mới + bảng API), README (bỏ "regex / áp ngược" khỏi mục còn thiếu, bỏ giới hạn `discord . gg`). Phase file: status completed, tick tiêu chí.

## Test
- Shared: 26 pass (dấu cách, `/discord\s*\.\s*gg/`, regex lỗi, `(a+)+` chặn, hoa/thường, NFD, regex khớp rỗng, nhóm bình thường không bị chặn).
- API: 202 pass (24 file). Mới: `claim-inputs.test.ts` (`withoutIgnored`), `series-ignore-apply.test.ts` (đếm đúng, đúng box bị ẩn, box tự thêm/không gắn vùng khớp không đụng, box đã ẩn không đếm, undo khôi phục, undo bỏ qua trang đã sửa, khoá người khác ở preview/apply/undo, job busy, stale, danh sách rỗng, validation), `tenant-isolation.test.ts` thêm 3 route (cả 403 chéo workspace lẫn 404 chéo tài nguyên).
- Web: 187 pass (thêm test rows, ignore-text-input, ignore-apply-model).
- Typecheck 0 lỗi, `pnpm lint` sạch, `pnpm schema:emit` chạy (zod không đổi bởi phase này).
- E2E: cả bộ 31 test pass; test mới trong `series-manage.spec.ts` chạy luồng xem trước → áp dụng → hoàn tác trên 2 chương dịch bằng worker giả (mục có dấu cách chen giữa, kiểm hidden qua API). Worker giả chỉ sinh vùng nên test tự PUT một box gắn vùng `t0` cho từng chương. Test dọn lại `ignore_text` về rỗng ở `finally`. Cập nhật câu lỗi mong đợi trong test e2e cũ ("không tính http:// và dấu cách").

## Lưu ý / quyết định
- Hoàn tác batch không còn → dùng 410 thay 404, vì test cách ly tenant coi 404 là "không thuộc tenant"; 410 cũng đúng nghĩa (history đã bị dọn hoặc đã hoàn tác).
- Chế độ undo của series không 409 toàn bộ như find-replace mà bỏ qua từng trang (đúng yêu cầu); find-replace giữ 409.
- Heuristic lượng từ lồng không chặn hết mẫu xấu (vd `(a|a)+`); chấp nhận theo phase (invite-only), `re2` là hướng nâng cấp.
- Mục bắt đầu và kết thúc bằng `/` luôn là regex (mục thường kiểu `/r/manga/` phải bỏ dấu `/` cuối).
- Biome tự định dạng một số file trong `apps/api`/`packages`; chỉ thay đổi định dạng trong file đã chạm.
- Phase 6: `series-settings-form.tsx` chỉ chạm ở 3 chỗ nhỏ quanh ô chữ bỏ qua.

## Câu hỏi còn mở
Không.
