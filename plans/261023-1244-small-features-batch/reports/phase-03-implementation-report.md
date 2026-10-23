# Báo cáo triển khai: Gửi email lời mời qua SMTP

## Kết quả
- Env `SMTP_URL` (smtp/smtps, tuỳ chọn) + `MAIL_FROM` (bắt buộc khi có `SMTP_URL`) trong `apps/api/src/env.ts`.
- `lib/mailer.ts`: nodemailer, timeout 10s (connection/greeting/socket), `sendMail` trả `false` khi chưa cấu hình, ném lỗi khi gửi hỏng; `describeMailError` che mật khẩu SMTP.
- `lib/invite-email.ts`: mail tiếng Việt (workspace, người mời, vai trò, link, hạn); HTML escape, bỏ xuống dòng trong tên.
- `auth.ts` `sendInvitationEmail`: gửi mail; thành công thì không log link; không SMTP hoặc lỗi thì log link như cũ (lỗi log đã che mật khẩu). Chữ ký callback better-auth 1.7.x đã kiểm: có `inviter.user`, `role`, `invitation.expiresAt`.
- `GET /w/:ws/invitations/:id/link` trả thêm `mail_enabled` (chỉ thêm trường).
- Web `InviteForm`: đổi câu khi mail bật ("Đã gửi email mời tới X. Không nhận được? Gửi link này…"), nút "Gửi lại email" cho lời mời vừa tạo (`inviteMember` với `resend: true`, giữ nguyên id/link).
- Docs: `.env.example`, `docs/development-setup.md`, `docs/deployment-guide.md` (bảng env, nhắc SPF/DKIM), README (đổi mục thành "Thử email lời mời với SMTP thật" vì code đã xong, còn thử tay).

## Test
- `apps/api/test/invite-email.test.ts` (mới): 1 mail đúng người nhận + link hợp lệ (token verify, đăng ký được), không log link; không SMTP; transport lỗi (200, log link, không lộ mật khẩu); gửi lại chỉ admin/owner (member 403) và gửi mail lần 2; escape HTML; env thiếu `MAIL_FROM` lỗi.
- Seam: sửa `env.*` + `vi.spyOn(nodemailer, "createTransport")` (cùng idiom budget.test.ts).
- `pnpm --filter @mtl/api test` 22 file / 183 pass; `@mtl/web` 181 pass; `pnpm typecheck` và `pnpm lint` sạch.

## Chưa làm / lưu ý
- Chưa thử tay với SMTP thật (tiêu chí còn mở trong phase file).
- `plan.md` chưa cập nhật bảng trạng thái (ngoài danh sách file được phép).
- Nút "Gửi lại email" chỉ cho lời mời vừa tạo trong phiên form; web chưa có danh sách lời mời đang chờ.
- Không thêm test web riêng cho `InviteForm` (repo chưa có test cho route này).
