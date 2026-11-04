# Review Phase 5 — hạn mức + đăng ký runtime

Score 8/10 · Critical 0 · High 0 · Medium 3 · Low 8. Review trên `phase5.patch` (đọc với staged tree), không chạy test.
(Reviewer không ghi file được; orchestrator ghi lại bản tóm tắt.)

Đúng: hook chặn email admin trước mọi DB read; form-post không bypass; fail-closed (500, không tạo user); `limits_required`
kiểm ở server + runtime; null = theo env; confirm 409 dưới khoá hàng settings; rate limit chỉ tắt ở `NODE_ENV=test`;
smoke dừng ở `PASSWORD_TOO_SHORT` trước khi ghi DB.

## Medium
- M1 Runbook chỉ nêu cách env (`docs/deployment-guide.md:102` kill-switch ngưỡng 0, `:293` nâng ngưỡng + restart;
  `scripts/budget-resume.ts:5`) — vô tác dụng khi DB đã có giá trị (DB thắng env). Sửa docs: giá trị UI khác null thắng env;
  khẩn cấp = đặt 0/tắt trên UI hoặc `UPDATE system_settings SET global_daily_usd=0` / `signup_enabled=false`; nâng hạn mức trên
  UI tự chạy lại job, không restart/`--force`. Tương tự `SIGNUP_ENABLED=false` không đóng khi UI đã bật.
- M2 `limits-section.tsx:136,158`: Huỷ dialog xác nhận → hiện mã thô `confirm_required`. Sửa: `save.reset()` khi Huỷ.
- M3 `limits-section.tsx:34,134,158`: lỗi 500/mạng sau "Vẫn lưu" bị ẩn; field vẫn sửa được khi dialog mở → lưu `pending.body` cũ.
  Sửa: clear `pending` ở `onError` với lỗi khác `confirm_required`; disable fieldset khi `pending`.

## Low
- L1 Doc cũ: `deployment-guide.md:81` (smoke "luôn 400"), `apps/api/src/lib/create-user.ts:3` nhắc `disableSignUp`, README dòng 3/39/148 chỉ nêu env.
- L2 Fallback DB ?? env viết 2 lần (`admin-settings.ts:76-81` vs `effectiveLimits`/`isSignupOpen`) → 1 hàm thuần `resolveLimits(stored)`.
- L3 Thiếu test fail-closed (`isSignupEnabled` throw → 500, không có user); test admin-email runtime nên assert không tạo user.
- L4 Toggle đăng ký không quay về "theo env" được; `effective.signup_enabled` là cờ thô, checkbox có thể nói mở khi `/healthz` báo `closed`; Save bị disable không giải thích khi `signupOn && !mayEnable` (`limits-section.tsx:52,105`).
- L5 `infra/smoke.sh` chạy tay >5 lần/giờ → 429 (bucket không IP); dòng `signup=$(curl…)` thoát dưới `set -e` không có `die`. Ghi chú header + `die`.
- L6 Giá trị nhỏ/lớn hiện dạng `1e-7` qua `usdText` → `parseUsd` từ chối. Dùng `toFixed` + bỏ 0 thừa.
- L7 `userDailyLimitSql` dùng tên cột thô thay vì drizzle ref.
- L8 `lockQueuedOverQuotaLlmJobs` (`user-quota.ts:76`) quét cả khi hạn mức null — trả `[]` sớm.

## Câu hỏi còn mở
- Có cần override khẩn cấp ở env (env 0 luôn thắng) không? Đụng quyết định D7/T17 "DB ?? env" → của user; tạm ghi docs.
