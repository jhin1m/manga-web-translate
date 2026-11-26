-- Ngôn ngữ giao diện của người dùng (web đồng bộ lên): job dịch / hiệu đính tự enqueue phía server vẫn biết viết ghi chú
-- AI (`style_note`, lý do hiệu đính) bằng ngôn ngữ nào. Null (người dùng cũ, chưa mở web bản mới) = tiếng Việt như trước.
ALTER TABLE "user" ADD COLUMN "ui_locale" text;