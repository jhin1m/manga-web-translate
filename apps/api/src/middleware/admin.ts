import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { env } from "../env.ts";
import type { AppEnv } from "./user.ts";

export const normalizeEmail = (s: string): string => s.trim().toLowerCase();

/** Email thuộc `ADMIN_EMAILS` (chuẩn hoá cả hai phía; đọc env lúc gọi). */
export const isAdminEmail = (email: unknown): boolean =>
  typeof email === "string" && env.ADMIN_EMAILS.some((e) => normalizeEmail(e) === normalizeEmail(email));

/** Sau `requireUser`: chỉ admin (403 `forbidden`). */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!isAdminEmail(c.get("user").email)) throw new HTTPException(403, { message: "forbidden" });
  await next();
});
