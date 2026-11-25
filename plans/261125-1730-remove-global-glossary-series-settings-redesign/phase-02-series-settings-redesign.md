---
status: done
---

# Phase 2 — Thiết kế lại Cài đặt series, tự lưu

## Hiện trạng

`apps/web/src/features/series/series-settings-form.tsx` (685 dòng): modal "Cài đặt dịch", luôn hiện Tên, ảnh bìa, Dịch
từ/Sang, Định dạng, Font thoại; 6 mục thu gọn (Giọng văn, Kính ngữ, Xưng hô, Font khác, Chữ bỏ qua, Ảnh tự bỏ); nút Lưu
dính đáy gửi diff (`settings-diff.ts`); Ảnh tự bỏ đã tự lưu.

## Bố cục mới (modal giữ nguyên, các nhóm luôn hiện, có tiêu đề nhóm)

1. **Series**: Tên, Ảnh bìa, Dịch từ / Sang (+ cảnh báo đổi ngôn ngữ: chỉ còn nhắc glossary riêng), Định dạng.
2. **Hướng dẫn cho AI** — mô tả: "AI đọc mục này mỗi lần dịch và tự bổ sung khi dịch (nhãn AI)."
   Giọng văn (textarea, chip AI), Kính ngữ (select), Xưng hô (bảng + "+ Thêm", chip AI theo hàng),
   dòng "Glossary: N thuật ngữ · Mở" → `?tab=glossary`.
3. **Font chữ**: Font thoại; Dẫn truyện / Suy nghĩ / Ghi chú (có thể thu gọn "Font khác" nếu dài).
4. **Bỏ qua khi dịch**: Chữ bỏ qua (+ áp lại), Ảnh tự bỏ.
- Đáy: link "Xoá series" + trạng thái lưu (`SaveStatus` từ `features/admin/settings-ui.tsx`). Không nút Lưu.

Dùng lại khung `SetGroup` / `SetRow` / `SaveStatus` của `features/admin/settings-ui.tsx` nếu hợp với bề rộng modal; nếu
`SetRow` hai cột quá chật, xếp dọc trong modal (không đổi giao diện trang Cài đặt).

## Tự lưu

- Select / font: lưu khi đổi. Ô chữ (Tên, Giọng văn, Chữ bỏ qua): lưu khi rời ô hoặc debounce ngắn; Tên trống không lưu.
- Xưng hô: lưu cả danh sách khi mọi hàng đủ người nói / người nghe / xưng gọi (rời ô); hàng thiếu báo lỗi tại hàng, chưa
  lưu. Xoá hàng lưu ngay.
- Chữ bỏ qua lỗi cú pháp: báo lỗi, không lưu.
- Mỗi lần PATCH chỉ gửi trường vừa đổi (giữ nguyên tắc không đè giá trị AI ghi lúc modal mở). Khi detail series được làm
  mới và người dùng không đang sửa trường đó, cập nhật form theo server (để chip AI / cặp AI mới hiện ra).
- Đóng modal khi đang có lượt lưu chờ (debounce) → lưu ngay trước khi đóng.
- Lưu lỗi → `SaveStatus` báo lỗi, giữ giá trị đang gõ.

## File

Sở hữu: `series-settings-form.tsx` (tách file con nếu giảm độ phức tạp thật, ví dụ `ai-instructions-section.tsx`,
`pronoun-rules-table.tsx`), `settings-summary.ts`, `settings-diff.ts` (+ test), `lang-labels.ts`, CSS liên quan,
`apps/web/e2e/series-manage.spec.ts` và spec e2e khác đang bấm "Lưu" trong Cài đặt series. Cập nhật
`docs/design-guidelines.md` phần Cài đặt series.

## Kiểm

Tuần tự, `nice`: web unit test, lint, typecheck, e2e `series-manage` (+ spec bị ảnh hưởng). Chụp màn modal để báo cáo.
