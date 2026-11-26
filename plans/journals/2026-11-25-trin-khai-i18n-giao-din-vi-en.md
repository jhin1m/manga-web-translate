---
title: Triển khai i18n giao diện vi + en
date: 2026-11-25
summary: "7 phase i18n xong (web, shared, mã lỗi API, worker, ui_locale), còn smoke LLM thật và image Docker"
---

# Triển khai i18n giao diện vi + en

## What happened
- Chạy plan `plans/261125-1440-i18n-vi-en` bằng subagent tuần tự từng phase (1→7) vì các phase cùng chạm `vi.json`/`en.json`, `job-error.ts`, `lib/api.ts`.
- Web: ~1.440 key vi+en, `t`/`tp`/`tNode`/`useT`, guard chữ Việt trên `apps/web/src` + `packages/shared/src` với allowlist theo dòng có lý do.
- API: hợp đồng lỗi `packages/shared/src/api-errors.ts` (mã + `variant` + `params`, `message` vi giữ nguyên cho client cũ); `onError` trả `http_<status>`.
- Worker: chi tiết `JobFailure` sang tiếng Anh; phát hiện hồi quy do chính thay đổi này — 4 chỗ web (xuất, cắt trang, OCR vùng, xoá chữ) hiện `job.error` thô làm câu chính, đã chuyển sang nhãn theo `error_class`.
- `ui_locale` trên `user` (migration 0033, backup DB dev trước khi migrate) → `ui_lang` trong payload job → prompt dặn viết `style_note`/`reason` theo ngôn ngữ đó. Nâng worker `PIPELINE_VERSION` và `MIN_PIPELINE_VERSION` lên 0.14.0 vì schema worker strict.
- Review: không critical. Sửa: `ui_lang` từ enum sang regex mã ngôn ngữ (thêm locale không cần nâng worker), placeholder thiếu param → dùng `message`, down 0033 gỡ `ui_lang` khỏi job đang chờ, 2 mã lỗi mask, `initI18n` hết giờ 5 giây.

## Decision
- `ui_lang` là chuỗi có kiểm dạng, không phải enum: giữ đúng lời hứa "thêm locale = JSON + dòng registry" (thực tế thêm cả mã vào `UI_LOCALES` shared).
- Không sửa chi tiết lỗi job do API sinh (`queue.ts`) vì test khoá nội dung, chỉ là chi tiết kỹ thuật.

## Next steps
- Smoke LLM thật ở locale en (proofread `reason`, `style_note`).
- Build image + smoke Docker theo quy trình release (có migration 0033, worker 0.14.0 phải lên trước API).
- 3 e2e đỏ có từ trước i18n: `full-flow` (upload qua `/files` cùng origin), `block-panel:317`, `click-budget:43` (chip "Đang chờ lượt").
- `docs/releases/v0.7.0.md` nhắc chế độ model "Tự động" của task khác chưa commit — bỏ nếu task đó không vào bản.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
