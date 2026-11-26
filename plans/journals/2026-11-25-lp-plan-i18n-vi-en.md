---
title: Lập plan i18n vi + en
date: 2026-11-25
summary: "Plan 7 phase đưa UI, lỗi API/worker và ghi chú AI về từ điển theo locale, vi gốc, en thêm mới"
---

# Lập plan i18n vi + en

## What happened
Brainstorm và lập plan i18n tại `plans/261125-1440-i18n-vi-en/` (7 phase, ~6.5d). Mục tiêu là quảng bá quốc tế: thêm English trước, các locale khác sau.
Khảo sát: khoảng 1.310 dòng chuỗi tiếng Việt trong 112 file web (riêng `features/chapter` chiếm 614 dòng), khoảng 370 dòng trong route API, 49 câu lỗi worker. Chưa có thư viện i18n.

## Decision
- Từ điển tự viết dạng `messages/{locale}.json` phẳng, placeholder `{name}`, không thêm dependency. Thêm locale = 1 file JSON + 1 dòng registry. Định dạng này giữ đường chuyển sang Paraglide/i18next ít tốn công.
- Lưu `ui_locale` trên bảng `user` qua `additionalFields` của better-auth (migration 0033), để job chạy nối tiếp tự động vẫn biết ngôn ngữ.
- `README.md` viết tiếng Anh, bản tiếng Việt chuyển sang `README.vi.md`.
- Câu lỗi chi tiết của worker chuyển sang tiếng Anh. Nhãn lỗi chính vẫn dịch theo `error_class`.

## Findings
- Playwright chưa ghim `locale`, nên Chromium dùng en-US. Khi bật tự nhận ngôn ngữ, khoảng 750 selector chữ Việt sẽ hỏng. Phải ghim `vi-VN` trước.
- Vitest của web chạy môi trường node, không có `navigator`. Vì vậy `t()` phải mặc định `vi` và chạy được ngoài React.
- Prompt `proofread_page.md` buộc `reason` viết bằng tiếng Việt. `style_note` theo ngôn ngữ của prompt nên cũng ra tiếng Việt.

## Next steps
`/ak-cook plans/261125-1440-i18n-vi-en/plan.md`, bắt đầu từ phase 1 (nền tảng + guard + ghim locale e2e).

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
