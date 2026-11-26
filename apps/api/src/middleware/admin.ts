import { createMiddleware } from "hono/factory";
import { env } from "../env.ts";
import { codeError } from "../lib/api-error.ts";
import type { AppEnv } from "./user.ts";

export const normalizeEmail = (s: string): string => s.trim().toLowerCase();

/**
 * Email thuộc `ADMIN_EMAILS` (chuẩn hoá cả hai phía; đọc env lúc gọi). Chế độ local: chỉ có 1 user (user local) và
 * không có đăng nhập → luôn là admin.
 */
export const isAdminEmail = (email: unknown): boolean =>
  env.MTL_LOCAL_MODE ||
  (typeof email === "string" && env.ADMIN_EMAILS.some((e) => normalizeEmail(e) === normalizeEmail(email)));

/** Sau `requireUser`: chỉ admin (403 `forbidden`). */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!isAdminEmail(c.get("user").email)) throw codeError(403, "forbidden");
  await next();
});
