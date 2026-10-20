import { AsyncLocalStorage } from "node:async_hooks";
import { workspaceSettings } from "@mtl/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { invitationLink, verifyInvitationToken } from "./lib/invite-token.ts";

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
  advanced: { database: { generateId: "uuid" } },
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
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
      sendInvitationEmail: async ({ id, email, organization: org }) => {
        // MVP chưa gửi mail: log link (owner/admin cũng lấy được qua GET /api/w/:ws/invitations/:id/link).
        console.info(`[invite] ${email} → workspace "${org.name}": ${invitationLink(id)}`);
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
