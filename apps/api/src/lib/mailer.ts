/** Gửi mail qua SMTP (nodemailer). Không đặt SMTP_URL → `sendMail` trả false và caller tự dùng đường log. */
import nodemailer from "nodemailer";
import { env } from "../env.ts";

export type MailMessage = { to: string; subject: string; text: string; html: string };

const TIMEOUT_MS = 10_000;

export const mailEnabled = (): boolean => !!env.SMTP_URL && !!env.MAIL_FROM;

/** Lỗi gửi mail → chuỗi log an toàn: không chứa mật khẩu SMTP (có thể nằm trong URL). */
export function describeMailError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const passwords = smtpPasswords();
  return passwords.reduce((out, pw) => out.split(pw).join("***"), msg);
}

/** Mật khẩu SMTP dạng thô (như trong URL) và dạng đã giải mã; không bao giờ ném lỗi (URL hay %-escape hỏng). */
function smtpPasswords(): string[] {
  if (!env.SMTP_URL) return [];
  try {
    const raw = new URL(env.SMTP_URL).password;
    if (!raw) return [];
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      // %-escape không hợp lệ: chỉ che dạng thô
    }
    return [...new Set([decoded, raw])].sort((a, b) => b.length - a.length);
  } catch {
    return [];
  }
}

/** true = đã gửi; false = chưa cấu hình SMTP. Lỗi gửi (kể cả timeout) được ném ra cho caller. */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  if (!env.SMTP_URL || !env.MAIL_FROM) return false;
  // Transport tạo mỗi lần gửi (không pool): mail lời mời hiếm, khỏi giữ kết nối nhàn rỗi.
  const transport = nodemailer.createTransport({
    url: env.SMTP_URL,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  try {
    await transport.sendMail({ from: env.MAIL_FROM, ...msg });
    return true;
  } finally {
    transport.close();
  }
}
