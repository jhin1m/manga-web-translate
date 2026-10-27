/**
 * Tạo tài khoản phía server (script `pnpm create-user`, test) — không qua HTTP sign-up nên không bị
 * `disableSignUp` chặn. Mật khẩu băm bằng đúng hàm của better-auth.
 */
import { user as userTable } from "@mtl/db";
import { eq } from "drizzle-orm";
import { auth } from "../auth.ts";
import { db } from "../db.ts";

export type UserInput = { email: string; name: string; password: string };

/** Tạo user + tài khoản credential; email đã có → lỗi. Trả id user. */
export async function createUser(input: UserInput): Promise<{ userId: string }> {
  const email = input.email.toLowerCase();
  const [existing] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1);
  if (existing) throw new Error(`user ${email} đã tồn tại`);
  if (input.password.length < 10) throw new Error("mật khẩu phải ≥ 10 ký tự");
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(input.password);
  const created = await ctx.internalAdapter.createUser(
    { email, name: input.name, emailVerified: false },
    { method: "email-password" },
  );
  if (!created) throw new Error("tạo user thất bại");
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: hash,
  });
  return { userId: created.id };
}
