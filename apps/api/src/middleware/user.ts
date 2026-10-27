import { type Scoped, scoped } from "@mtl/db";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { type AuthSession, auth } from "../auth.ts";
import { db } from "../db.ts";

/** Header web gửi kèm mọi request: id tab (uuid, `sessionStorage`) — khoá chương giữ theo từng tab. */
export const TAB_ID_HEADER = "x-tab-id";
const TAB_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export type UserVars = {
  user: AuthSession["user"];
  session: AuthSession["session"];
  userId: string;
  /** Người giữ khoá chương của request này: `${userId}:${tabId}` (thiếu header → tab `default`). */
  lockHolder: string;
  sdb: Scoped;
};
export type AppEnv = { Variables: UserVars };

/**
 * Bắt buộc đăng nhập (401). Gắn một lần cho mọi route người dùng dưới `/api` (xem app.ts) — dữ liệu luôn thuộc
 * người đang đăng nhập: `sdb = scoped(db, userId)`, route chỉ truy cập DB qua đây.
 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const s = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!s) throw new HTTPException(401, { message: "unauthenticated" });
  const tab = c.req.header(TAB_ID_HEADER);
  c.set("user", s.user);
  c.set("session", s.session);
  c.set("userId", s.user.id);
  c.set("lockHolder", `${s.user.id}:${tab && TAB_ID_RE.test(tab) ? tab : "default"}`);
  c.set("sdb", scoped(db, s.user.id));
  await next();
});
