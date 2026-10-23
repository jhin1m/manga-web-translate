---
phase: 5
title: "Chữ bỏ qua: so khớp bỏ dấu cách, regex, áp ngược cho chương đã dịch"
status: completed
priority: P2
effort: "1d"
dependencies: []
---

# Phase 5: Chữ bỏ qua — bỏ dấu cách, regex, áp ngược

## Overview
(a) So khớp không phân biệt dấu cách (sửa `discord . gg`), (b) entry dạng `/mẫu/` là regex, (c) nút ở cài đặt series
ẩn box khớp danh sách trong các chương đã dịch, có xem trước và hoàn tác.

## Hiện trạng
- `packages/shared/src/ignore-text.ts`: `normalizeIgnoreText` (NFC, lowercase, bỏ `http(s)://`, gộp khoảng trắng),
  `isIgnoredText` = substring; `isValidIgnoreEntry` 3–100 ký tự; tối đa 50 mục.
- Áp lúc claim (`apps/api/src/jobs/claim-inputs.ts:92-137, 186-216`: `withoutIgnored` đánh `empty`) và hiển thị
  (`apps/web/src/features/chapter/text-table/rows.ts:76`). Không sửa dữ liệu đã lưu → chương đã dịch không đổi.
- Engine sửa hàng loạt có hoàn tác: `apps/api/src/routes/find-replace.ts` (preview → apply có `versions` → undo theo
  `batch_id`, ghi `page_state_history`, khoá chương, undo 409 nếu page đã đổi tiếp). Chỉ sửa text, chưa có thao tác ẩn
  box. `TextBox.hidden` đã có trong schema.
- Chưa có test cho `withoutIgnored` và rule ẩn ở `rows.ts`.

## Requirements
- Functional:
  - **Mục thường**: khớp khi `strip(norm(text))` chứa `strip(norm(entry))` (`strip` = bỏ mọi khoảng trắng). Độ dài tối
    thiểu đo trên dạng đã strip.
  - **Mục regex** `/…/`: biên dịch với cờ `iu`, chạy trên `norm(text)`; không cho cờ tuỳ chọn. Không hợp lệ (không biên
    dịch được, dài > 100, có lượng từ lồng kiểu `(a+)+` / `(.*)*`) → lỗi validation theo từng dòng ở form.
  - `compileIgnoreList(list) → (text) => boolean` dùng chung api claim + web text-table (biên dịch 1 lần mỗi danh sách).
  - **Áp ngược** (cài đặt series, dưới ô chữ bỏ qua, chỉ khi đã lưu danh sách):
    - "Ẩn chữ khớp trong chương đã dịch…" → xem trước: theo chương, số box sẽ ẩn + vài mẫu `source_text`; chương bị
      người khác giữ khoá / đang chạy job liệt kê là "bỏ qua".
    - Áp dụng: với mỗi region có `source_text` khớp, mọi box `region_id` = region đó và chưa ẩn → `hidden = true`.
      Không xoá box, không đổi translation. Ghi history `origin = user`, version +1, chung một `batch_id`.
    - Toast "Đã ẩn N box ở M chương · Hoàn tác". Hoàn tác theo `batch_id`; page đã đổi sau đó → bỏ qua page đó và báo.
- Non-functional: mỗi chương 1 tx + khoá riêng (một chương lỗi không lăn ngược chương khác); giới hạn regex để tránh
  treo (đầu vào từ thành viên nhóm, invite-only → rủi ro tự gây, chặn bằng heuristic + độ dài).

## Architecture
- `ignore-text.ts`: `parseIgnoreEntry(raw) → {kind: "text", key} | {kind: "regex", re} | {error}`;
  `isValidIgnoreEntry` trả lý do lỗi (đổi chữ ký có kiểm soát, cập nhật nơi gọi); `compileIgnoreList`; giữ
  `isIgnoredText` làm wrapper.
- API: tách lõi find-replace thành hàm thuần dùng lại được: duyệt page state theo chương, áp phép biến đổi
  `(state) → {state, matches}`, ghi history/batch. Thêm phép `hideIgnored(matcher)`. Route mới ở series:
  `POST /w/:ws/series/:seriesId/ignore-apply/preview`, `.../apply` (kèm `versions` từ preview), `.../undo`
  (`batch_id`). Khoá: cho phép khi chương không bị người khác giữ (lấy/nhả khoá trong tx), bỏ qua chương `processing`.
- Web: `series-settings-form.tsx` nút + dialog xem trước (tái dùng component xem trước của FindReplace/glossary-apply
  nếu hợp), toast hoàn tác; `ignore-text-input.ts` hiện lỗi từng dòng.
- Phase 1 không cần làm gì thêm: ẩn box ghi `page_states` → chương tự vào "cần xuất lại".

## Related Code Files
- Modify: `packages/shared/src/ignore-text.ts` (+ `packages/shared/test/ignore-text.test.ts`),
  `apps/api/src/jobs/claim-inputs.ts`, `apps/api/src/routes/series.ts` (validation), `apps/api/src/routes/find-replace.ts`
  (tách lõi), `apps/web/src/features/chapter/text-table/rows.ts`, `apps/web/src/features/series/series-settings-form.tsx`,
  `apps/web/src/features/series/ignore-text-input.ts` (+ test)
- Create: `apps/api/src/routes/series-ignore-apply.ts` (hoặc trong `series.ts` nếu ngắn), test API tương ứng
- Test: `apps/api/test/tenant-isolation.test.ts` (3 route mới), test claim filter mới
- Docs: `docs/job-queue-worker.md` (mục chữ bỏ qua), `docs/export-and-batch-edit.md`, README (gạch mục; bỏ giới hạn
  `discord . gg` ở "Giới hạn đã biết")

## Implementation Steps
1. Shared: parse/compile/validate + test (dấu cách, `/discord\s*\.\s*gg/`, regex lỗi, `(a+)+` bị chặn, hoa/thường,
   tiếng Việt NFD).
2. Đổi claim-inputs + rows.ts sang `compileIgnoreList`; thêm test `withoutIgnored`.
3. Tách lõi find-replace (giữ nguyên hành vi + test cũ xanh trước khi thêm phép mới).
4. Route preview/apply/undo + test (đếm đúng, ẩn đúng box, không đụng box không gắn region khớp, undo khôi phục, undo
   409/bỏ qua khi page đổi tiếp, chương người khác giữ khoá bị bỏ qua, tenant isolation).
5. Web: lỗi từng dòng + nút/dialog/toast; e2e trong `series-manage.spec.ts`.
6. Docs.

## Success Criteria
- [x] Test shared/api/web/e2e xanh; test find-replace + glossary-apply cũ không đổi.
- [x] `discord . gg` khớp entry `discord.gg`.
- [x] Áp ngược trên series có ≥2 chương đã dịch → box watermark biến mất ở editor + bản xuất; hoàn tác trả lại.

## Risk Assessment
- Bỏ dấu cách làm entry ngắn khớp rộng hơn ("a b c" → "abc") → giữ ngưỡng tối thiểu 3 ký tự sau strip; xem trước trước
  khi áp ngược.
- Regex treo (ReDoS) ở API claim → heuristic chặn lượng từ lồng + độ dài 100 + text OCR ngắn; nếu thấy chưa đủ, chuyển
  sang `re2` sau.
- Tách lõi find-replace có thể làm vỡ hành vi cũ → refactor trước, test cũ phải xanh rồi mới thêm phép mới.
