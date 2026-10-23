import { AsyncLocalStorage } from "node:async_hooks";
import { workspaceSettings } from "@mtl/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { inviteEmail } from "./lib/invite-email.ts";
import { recordInviteMail } from "./lib/invite-mail-status.ts";
import { invitationLink, verifyInvitationToken } from "./lib/invite-token.ts";
import { describeMailError, sendMail } from "./lib/mailer.ts";

/** Header client gửi khi đăng ký từ link mời — bắt buộc: id khớp lời mời còn hạn của đúng email + token HMAC của id. */
export const INVITATION_HEADER = "x-invitation-id";
export const INVITATION_TOKEN_HEADER = "x-invitation-token";
const INVITATION_TTL_S = 7 * 24 * 3600;

/**
 * Cửa bỏ qua kiểm tra lời mời — chỉ code server (scripts/create-workspace.ts, test) gọi được,
 * không có đường nào từ HTTP đi vào AsyncLocalStorage này.
 */
const inviteBypass = new AsyncLocalStorage<true>();
export const withoutInviteGate = <T>(fn: () => Promise<T>): Promise<T> => inviteBypass.run(true, fn);

type InvitationRow = { id: string; email: string; status: string; expiresAt: Date };

export const auth = betterAuth({
  appName: "mtl",
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: "/api/auth",
  trustedOrigins: [env.WEB_ORIGIN],
  database: drizzleAdapter(db, { provider: "pg" }),
  advanced: {
    database: { generateId: "uuid" },
    // IP client cho rate limit: Caddy đặt X-Real-IP = {client_ip} (đã giải CF-Connecting-IP qua trusted_proxies
    // Cloudflare) — không đọc X-Forwarded-For do client tự gửi được.
    ipAddress: { ipAddressHeaders: ["x-real-ip"] },
  },
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  // Phiên sống 7 ngày, tự gia hạn khi dùng (mỗi ngày tối đa 1 lần) — đúng mặc định better-auth, ghi tường minh.
  session: { expiresIn: 7 * 24 * 3600, updateAge: 24 * 3600 },
  telemetry: { enabled: false },
  databaseHooks: {
    user: {
      create: {
        // Invite-only: chặn ở server cho mọi đường tạo user (kể cả gọi thẳng /api/auth/sign-up/email).
        before: async (user, ctx) => {
          if (inviteBypass.getStore()) return;
          const headers = ctx?.headers ?? ctx?.request?.headers;
          const invitationId = headers?.get(INVITATION_HEADER);
          const token = headers?.get(INVITATION_TOKEN_HEADER);
          if (!ctx || !invitationId || !token || !verifyInvitationToken(invitationId, token)) {
            throw new APIError("FORBIDDEN", { message: "Sign-up requires a valid invitation link" });
          }
          const inv = (await ctx.context.adapter.findOne({
            model: "invitation",
            where: [{ field: "id", value: invitationId }],
          })) as InvitationRow | null;
          const valid =
            inv &&
            inv.status === "pending" &&
            new Date(inv.expiresAt).getTime() > Date.now() &&
            inv.email.toLowerCase() === user.email.toLowerCase();
          if (!valid) throw new APIError("FORBIDDEN", { message: "Invitation is invalid or expired" });
        },
      },
    },
  },
  plugins: [
    organization({
      // Workspace chỉ tạo bằng scripts/create-workspace.ts (system action, không session).
      allowUserToCreateOrganization: false,
      invitationExpiresIn: INVITATION_TTL_S,
      cancelPendingInvitationsOnReInvite: true,
      sendInvitationEmail: async ({ id, email, role, organization: org, inviter, invitation: inv }) => {
        const link = invitationLink(id);
        // Link chứa token đăng ký → chỉ log khi không gửi được mail; lời mời luôn được tạo dù mail lỗi.
        try {
          const mail = inviteEmail({
            to: email,
            workspaceName: org.name,
            inviterName: inviter.user.name || inviter.user.email,
            role,
            link,
            expiresAt: new Date(inv.expiresAt),
          });
          const sent = await sendMail(mail);
          recordInviteMail(id, sent);
          if (sent) return;
        } catch (err) {
          recordInviteMail(id, false);
          console.error(`[invite] gửi email tới ${email} lỗi: ${describeMailError(err)}`);
        }
        // Owner/admin cũng lấy được link qua GET /api/w/:ws/invitations/:id/link.
        console.info(`[invite] ${email} → workspace "${org.name}": ${link}`);
      },
      organizationHooks: {
        afterCreateOrganization: async ({ organization: org }) => {
          await db.insert(workspaceSettings).values({ workspaceId: org.id }).onConflictDoNothing();
        },
      },
    }),
  ],
});

export type Auth = typeof auth;
export type AuthSession = typeof auth.$Infer.Session;
