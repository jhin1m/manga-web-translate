# Code review: web gợi ý từ AI (series)

Ngày 11/11/2026. Reviewer chỉ đọc, không sửa file. Điểm **7/10**: 0 Critical, 1 High, 2 Medium, 7 Low.

Lệnh đã chạy:
- `pnpm --filter @mtl/web test`: 460 pass. `typecheck` và `lint` sạch.
- E2E `series-suggestions`, `series-manage`, `glossary-language-pair`: 13/13 pass.
- E2E `series-suggestions` chạy trước `upload-chapter`: **2 fail, lặp lại được** (xem H1).

## High

**H1. `series-suggestions.spec.ts` không xoá series nó tạo ("Gợi ý AI e2e"), làm vỡ 2 test của `upload-chapter.spec.ts`.**
- Thả file ở home sẽ chọn series của chương mới nhất (`resolveDropSeries`). Series thừa này chiếm chỗ đó.
- 2 test bị vỡ: "drop a 10-page ZIP on home…" và "series page: 3 loose images…".
- Report phase 4 gọi đây là lỗi chập chờn, nhưng lần chạy lại của nó không có spec gợi ý nên không tái hiện được.
- Sửa: xoá series trong `finally` hoặc `afterEach`.

## Medium

- **M1.** Nhận thành công thì `onSuccess` invalidate mà không chờ, nên hàng đó còn bấm được cho tới khi danh sách tải lại. Mạng chậm mà bấm lần 2 thì nhận 409 và câu "đã có trong glossary" (dễ hiểu nhầm là lỗi). Sửa: chờ refetch trong `onSuccess`, hoặc gỡ hàng khỏi cache ngay. Áp dụng tương tự cho Bỏ.
- **M2.** Mất focus (về `body`) sau Nhận hoặc Bỏ. Codebase đã có mẫu xử lý: `proofread-panel.tsx` `focusHead`.

## Low

- **L1.** Badge không được đọc đúng bằng trình đọc màn hình:
  - Tên link thành "Glossary · 0 3".
  - Badge của icon Cài đặt bị `aria-label` che mất.
  - Sửa: `aria-hidden` cho badge, kèm phần chữ `sr-only` hoặc đưa số vào `aria-label`.
- **L2.** Dòng nhắc "Đã thêm vào bảng — bấm Lưu…" không tắt khi người dùng xoá hàng vừa Nhận.
- **L3.** Lỗi mạng hiện ở dạng `small muted`, trong khi codebase dùng `small error` cho lỗi.
- **L4.** Badge không tự cập nhật khi người dùng đứng yên ở màn series lúc dịch xong. Plan đã chấp nhận rủi ro này.
- **L5.** `TermKind` khai báo lại ở `series/api.ts`, trong khi `@mtl/shared` đã có.
- **L6.** Hai lỗi hiển thị nhỏ:
  - Ở 360px, cột từ gốc xuống dòng từng âm tiết.
  - Nhãn ghi "Ch. 1", trong khi cả app dùng "Ch.N".
- **L7.** Spec chép lại khoảng 40 dòng của `apiReadyChapter`, vì helper cố định `state.seriesId`.

## Đã xác minh đạt

- Kiểu dữ liệu khớp API.
- Giới hạn độ dài khớp nhau giữa glossary, quy tắc xưng hô và `LearnedTerm`/`LearnedPronoun`.
- Server và client cùng một luật để quyết định gợi ý nào đã có.
- Invalidate đủ mọi đường. Prefix `["series"]` bao luôn key gợi ý.
- `rulesSummary` giữ nguyên chuỗi cũ khi không có gợi ý chờ duyệt.
- `/^Glossary/` vẫn khớp.
- Form chỉ khởi tạo state một lần, nên refetch không ghi đè chỗ người dùng đang sửa.
- Mọi nút đều `type="button"`. Hook được gọi trước các return sớm.
- Chuỗi do LLM sinh ra được render dạng text thường.
- `fake-worker` giữ nguyên hành vi với các spec cũ.

## Xử lý (lead quyết)

| Mục | Quyết định |
|---|---|
| H1, M1, M2, L1, L2, L3, L5, L6, L7 | Sửa |
| L4 | Không sửa: plan đã chấp nhận, badge làm mới khi focus hoặc mount (YAGNI) |
| `apps/web/.claude/` (untracked, có từ trước session này) | Không đụng, không commit |
