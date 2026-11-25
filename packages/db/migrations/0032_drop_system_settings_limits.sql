-- Hạn mức USD/ngày + đăng ký chỉ cấu hình trong `.env` (USER_DAILY_USD, GLOBAL_DAILY_USD, SIGNUP_ENABLED): bỏ 3 cột
-- ghi đè từ UI admin của system_settings. Giá trị đang lưu (nếu có) mất — đặt lại trong `.env` trước khi nâng cấp.
ALTER TABLE "system_settings" DROP COLUMN "user_daily_usd";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "global_daily_usd";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "signup_enabled";