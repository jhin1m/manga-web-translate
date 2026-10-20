import { isUuid, member, type Scoped, scoped } from "@mtl/db";
import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { type AuthSession, auth } from "../auth.ts";
import { db } from "../db.ts";

/** Role mặc định của better-auth organization; ma trận chi tiết để Phase 8. */
export const ROLES = ["member", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];
const rank = (r: string) => ROLES.indexOf(r as Role);

export type SessionVars = { user: AuthSession["user"]; session: AuthSession["session"] };
export type WorkspaceVars = SessionVars & { workspaceId: string; role: Role; sdb: Scoped };
export type AppEnv = { Variables: WorkspaceVars };

/** 401 nếu chưa đăng nhập. */
export const requireSession = createMiddleware<{ Variables: SessionVars }>(async (c, next) => {
  const s = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!s) throw new HTTPException(401, { message: "unauthenticated" });
  c.set("user", s.user);
  c.set("session", s.session);
  await next();
});

/**
 * Workspace lấy từ path `:ws` (không từ header). Người gọi không phải thành viên → 403;
 * `:ws` không phải uuid → 404. Gắn `sdb = scoped(db, ws)` — route chỉ truy cập DB qua đây.
 */
export const requireWorkspace = (minRole: Role = "member") =>
  createMiddleware<{ Variables: WorkspaceVars }>(async (c, next) => {
    const ws = c.req.param("ws");
    if (!ws || !isUuid(ws)) throw new HTTPException(404, { message: "workspace not found" });
    const s = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!s) throw new HTTPException(401, { message: "unauthenticated" });
    const [m] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, ws), eq(member.userId, s.user.id)))
      .limit(1);
    if (!m) throw new HTTPException(403, { message: "not a member of this workspace" });
    // better-auth cho phép nhiều role "a,b": lấy role cao nhất.
    const role = m.role
      .split(",")
      .map((r) => r.trim())
      .filter((r): r is Role => rank(r) >= 0)
      .sort((a, b) => rank(b) - rank(a))[0];
    if (!role || rank(role) < rank(minRole)) throw new HTTPException(403, { message: `requires role ${minRole}` });
    c.set("user", s.user);
    c.set("session", s.session);
    c.set("workspaceId", ws);
    c.set("role", role);
    c.set("sdb", scoped(db, ws));
    await next();
  });
