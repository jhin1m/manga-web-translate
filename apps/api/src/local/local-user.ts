/**
 * User duy nhất của chế độ local (không tài khoản/mật khẩu): tạo/lấy lúc boot, `requireUser` gắn cho mọi request.
 * Không có bản ghi `account` → không đăng nhập được qua better-auth kể cả khi ai đó bật lại route auth.
 */
import { type DbLike, user } from "@mtl/db";
import { eq } from "drizzle-orm";
import type { AuthSession } from "../auth.ts";

export const LOCAL_USER_EMAIL = "local@localhost";

export type LocalUser = AuthSession["user"];

let current: LocalUser | null = null;

/** Lấy user local (tạo nếu chưa có) và giữ trong bộ nhớ process. */
export async function ensureLocalUser(conn: DbLike): Promise<LocalUser> {
  await conn
    .insert(user)
    .values({ name: "Local", email: LOCAL_USER_EMAIL, emailVerified: true })
    .onConflictDoNothing({ target: user.email });
  // User local bị khoá (DB nhập từ bản VPS / SQL tay) → mọi request 403 và web lặp chuyển trang → luôn mở khoá.
  const [row] = await conn.update(user).set({ disabledAt: null }).where(eq(user.email, LOCAL_USER_EMAIL)).returning();
  if (!row) throw new Error("không tạo được user local");
  current = row as LocalUser;
  return current;
}

/** User local đã boot; chưa gọi `ensureLocalUser` → lỗi (lỗi cấu hình, không phải lỗi người dùng). */
export function getLocalUser(): LocalUser {
  if (!current) throw new Error("user local chưa khởi tạo — bootLocal() chưa chạy");
  return current;
}

export function setLocalUserForTest(u: LocalUser | null): void {
  current = u;
}
