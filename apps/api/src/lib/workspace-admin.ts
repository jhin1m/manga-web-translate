/**
 * Tác vụ quản trị chạy phía server (script, test) — không có route HTTP tương ứng.
 * Người dùng không tự tạo được workspace (allowUserToCreateOrganization: false).
 */
import { invitation, isUuid, NotFoundError, user as userTable } from "@mtl/db";
import { and, eq } from "drizzle-orm";
import { auth, withoutInviteGate } from "../auth.ts";
import { db } from "../db.ts";
import { invitationLink } from "./invite-token.ts";

export type OwnerInput = { email: string; name: string; password?: string };

/** Tạo (hoặc dùng lại) user owner rồi tạo workspace với owner đó. Trả về id workspace + user. */
export async function createWorkspace(input: { name: string; slug: string; owner: OwnerInput }) {
  const email = input.owner.email.toLowerCase();
  let [owner] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1);
  if (!owner) {
    if (!input.owner.password) throw new Error(`user ${email} does not exist; a password is required to create it`);
    const password = input.owner.password;
    const res = await withoutInviteGate(() =>
      auth.api.signUpEmail({ body: { email, name: input.owner.name, password } }),
    );
    owner = { id: res.user.id };
  }
  // System action (userId, không session): được phép dù allowUserToCreateOrganization=false.
  const org = await auth.api.createOrganization({ body: { name: input.name, slug: input.slug, userId: owner.id } });
  if (!org) throw new Error("organization was not created");
  return { workspaceId: org.id, ownerId: owner.id };
}

/** Link mời (có token) của lời mời còn pending thuộc workspace; khác workspace / không có → NotFoundError. */
export async function pendingInvitationLink(workspaceId: string, invitationId: string): Promise<string> {
  if (!isUuid(invitationId)) throw new NotFoundError("invitation");
  const [inv] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(invitation.id, invitationId),
        eq(invitation.organizationId, workspaceId),
        eq(invitation.status, "pending"),
      ),
    )
    .limit(1);
  if (!inv) throw new NotFoundError("invitation");
  return invitationLink(inv.id);
}
