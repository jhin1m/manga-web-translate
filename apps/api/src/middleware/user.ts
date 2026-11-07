import { type Scoped, scoped } from "@mtl/db";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { type AuthSession, auth } from "../auth.ts";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { getLocalUser } from "../local/local-user.ts";

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

const FAR_FUTURE = new Date("9999-12-31T00:00:00Z");

/** Chế độ local: không đăng nhập — mọi request là user local (tạo lúc boot); phiên tổng hợp, không lưu DB. */
function localSession(): AuthSession {
  const user = getLocalUser();
  const session = {
    id: "local",
    userId: user.id,
    token: "local",
    expiresAt: FAR_FUTURE,
    createdAt: user.createdAt,
    updatedAt: user.createdAt,
    ipAddress: null,
    userAgent: null,
  } as AuthSession["session"];
  return { user, session };
}

/**
 * Bắt buộc đăng nhập (401). Gắn một lần cho mọi route người dùng dưới `/api` (xem app.ts) — dữ liệu luôn thuộc
 * người đang đăng nhập: `sdb = scoped(db, userId)`, route chỉ truy cập DB qua đây.
 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const s = env.MTL_LOCAL_MODE ? localSession() : await auth.api.getSession({ headers: c.req.raw.headers });
  if (!s) throw new HTTPException(401, { message: "unauthenticated" });
  // Phiên còn sót sau khi khoá (race giữa đặt cờ và xoá phiên).
  if (s.user.disabledAt) {
    throw new HTTPException(403, { res: Response.json({ error: "user_disabled" }, { status: 403 }) });
  }
  const tab = c.req.header(TAB_ID_HEADER);
  c.set("user", s.user);
  c.set("session", s.session);
  c.set("userId", s.user.id);
  c.set("lockHolder", `${s.user.id}:${tab && TAB_ID_RE.test(tab) ? tab : "default"}`);
  c.set("sdb", scoped(db, s.user.id));
  await next();
});
