---
phase: 3
title: "Gửi email lời mời qua SMTP"
status: completed
priority: P2
effort: "3h"
dependencies: []
---

# Phase 3: Gửi email lời mời qua SMTP

## Overview
Mời thành viên → gửi email chứa link nhận lời mời qua SMTP (nodemailer). Không cấu hình SMTP → giữ hành vi cũ.

## Hiện trạng
- `apps/api/src/auth.ts:68-77`: plugin organization, `sendInvitationEmail` chỉ `console.info("[invite] …")` kèm link.
- `apps/api/src/lib/invite-token.ts:9-19`: `invitationLink(id)` = `${WEB_ORIGIN}/accept-invite?id=…&token=<HMAC>`.
- `apps/api/src/routes/workspaces.ts:45` `GET /w/:ws/invitations/:id/link` (admin) trả link cho UI.
- Web `apps/web/src/routes/workspaces.tsx:63-95` `InviteForm` → hiện "Gửi link này cho họ".
- Chưa có thư viện mail, chưa có env SMTP.

## Requirements
- Functional:
  - Env `SMTP_URL` (optional, `smtp://` / `smtps://user:pass@host:port`) và `MAIL_FROM` (bắt buộc khi có `SMTP_URL`).
  - Có SMTP → gửi mail tiếng Việt: tên workspace, người mời, vai trò, link, hạn lời mời. Không log link khi gửi thành
    công.
  - Không SMTP hoặc gửi lỗi → lời mời **vẫn được tạo**, log như cũ (lỗi log không kèm mật khẩu SMTP), UI vẫn hiện link.
  - UI: biết mail đã bật hay chưa để đổi câu ("Đã gửi email mời tới X. Không nhận được? Gửi link này" / câu cũ). Nút
    "Gửi lại email" cho lời mời đang chờ (better-auth `inviteMember` với `resend: true`) khi mail bật.
- Non-functional: timeout kết nối/gửi ~10s để request mời không treo; link chứa token → coi là bí mật (không đưa vào
  log khi đã gửi được).

## Architecture
- `apps/api/src/lib/mailer.ts`: transport nodemailer tạo lười từ `SMTP_URL`; `sendMail(msg): Promise<boolean>`
  (false khi chưa cấu hình); test thay transport (`setMailTransport` hoặc nodemailer `jsonTransport`) theo idiom repo.
- `apps/api/src/lib/invite-email.ts`: dựng `{subject, text, html}` từ dữ liệu lời mời (HTML tối giản, escape tên).
- `auth.ts` `sendInvitationEmail`: `invitationLink` → `sendMail` → false/lỗi thì fallback log cũ. Kiểm chữ ký callback
  better-auth 1.7.11 (`inviter`, `role` có sẵn chưa).
- `GET .../link` trả thêm `mail_enabled: boolean` (hoặc endpoint cấu hình workspace có sẵn — chọn chỗ ít đổi nhất).

## Related Code Files
- Create: `apps/api/src/lib/mailer.ts`, `apps/api/src/lib/invite-email.ts`
- Modify: `apps/api/package.json` (nodemailer + @types/nodemailer), `apps/api/src/env.ts`, `apps/api/src/auth.ts`,
  `apps/api/src/routes/workspaces.ts`, `apps/web/src/routes/workspaces.tsx`, `.env.example`
- Docs: `docs/development-setup.md:17`, `docs/deployment-guide.md` (mục SMTP), README (gạch mục "Gửi email lời mời")
- Test: `apps/api/test/invite-only-auth.test.ts` (hoặc file mới `invite-email.test.ts`)

## Implementation Steps
1. Env + zod refine (`MAIL_FROM` bắt buộc khi có `SMTP_URL`).
2. `mailer.ts` + `invite-email.ts`.
3. Nối `sendInvitationEmail`, giữ fallback.
4. Link endpoint trả `mail_enabled`; web đổi câu + nút gửi lại.
5. Docs + `.env.example`.

## Tests
- Có transport giả: mời → 1 mail tới đúng email, chứa link nhận lời mời hợp lệ (token verify được), không log link.
- Không `SMTP_URL`: mời thành công, không throw, log như cũ.
- Transport throw: mời vẫn 200, log lỗi.
- `SMTP_URL` có mà thiếu `MAIL_FROM` → env parse lỗi.
- Gửi lại: chỉ admin/owner; gửi mail lần 2.

## Success Criteria
- [x] Test trên xanh; test invite-only cũ xanh.
- [ ] Thử tay với 1 SMTP thật (vd. Gmail app password / Brevo) nhận được mail, bấm link đăng ký được.

## Risk Assessment
- Mail vào spam (chưa SPF/DKIM) → doc deployment nhắc dùng SMTP của nhà cung cấp có domain verify; link trên UI vẫn còn.
- SMTP chậm làm chậm request mời → timeout + bắt lỗi.
