/**
 * Token đăng ký của lời mời = HMAC(BETTER_AUTH_SECRET, invitationId). Invitation id lộ cho mọi thành viên
 * (better-auth list-invitations), nên id một mình không đủ chứng minh là người được mời; token chỉ nằm trong
 * link mời mà owner/admin lấy được.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.ts";

export const invitationToken = (invitationId: string) =>
  createHmac("sha256", env.BETTER_AUTH_SECRET).update(`invitation:${invitationId}`).digest("base64url");

export function verifyInvitationToken(invitationId: string, token: string): boolean {
  const a = Buffer.from(invitationToken(invitationId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const invitationLink = (invitationId: string) =>
  `${env.WEB_ORIGIN}/accept-invite?id=${invitationId}&token=${invitationToken(invitationId)}`;
