/**
 * Người dùng (admin): danh sách kèm chi phí (usage_ledger, ngày UTC) + khoá / mở tài khoản.
 * Khoá = đặt `user.disabled_at` TRƯỚC rồi xoá phiên (xoá trước thì phiên mới có thể được tạo ở giữa); đăng nhập lại bị
 * hook `session.create.before` (auth.ts) từ chối, job của họ không được claim (`claimableSql`).
 */
import { type DbLike, isUuid, usageLedger, user } from "@mtl/db";
import { desc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { auth } from "../auth.ts";
import { dayStart } from "../billing/user-quota.ts";
import { inJobTx } from "../jobs/enqueue.ts";
import { fail } from "../lib/ai-providers.ts";
import { isAdminEmail } from "../middleware/admin.ts";
import type { AppEnv } from "../middleware/user.ts";

export const adminUserRoutes = new Hono<AppEnv>();

const LIMIT = 500;
const round = (n: string | null) => Math.round(Number(n ?? 0) * 1e4) / 1e4;
// Escape ký tự đặc biệt của LIKE để `q` là chuỗi con theo nghĩa đen.
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

/** Tối đa 500 người, mới nhất trước; `q` lọc theo email / tên. Chi phí gộp 1 truy vấn (30 ngày + hôm nay). */
adminUserRoutes.get("/users", async (c) => {
  const q = c.req.query("q")?.trim();
  const pattern = q ? likePattern(q) : null;
  const where: SQL | undefined = pattern ? or(ilike(user.email, pattern), ilike(user.name, pattern)) : undefined;
  const rows = await inJobTx((t) => listUsers(t, where));
  return c.json(
    rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      created_at: r.createdAt.toISOString(),
      disabled_at: r.disabledAt?.toISOString() ?? null,
      is_admin: isAdminEmail(r.email),
      cost_today_usd: round(r.today),
      cost_30d_usd: round(r.d30),
    })),
  );
});

function listUsers(t: DbLike, where: SQL | undefined) {
  const cost = t
    .select({
      userId: usageLedger.userId,
      today: sql<string>`sum(${usageLedger.costUsd}) filter (where ${usageLedger.createdAt} >= ${dayStart})`.as(
        "today",
      ),
      d30: sql<string>`sum(${usageLedger.costUsd})`.as("d30"),
    })
    .from(usageLedger)
    .where(sql`${usageLedger.createdAt} >= now() - interval '30 days'`)
    .groupBy(usageLedger.userId)
    .as("cost");
  return t
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      disabledAt: user.disabledAt,
      today: cost.today,
      d30: cost.d30,
    })
    .from(user)
    .leftJoin(cost, eq(cost.userId, user.id))
    .where(where)
    .orderBy(desc(user.createdAt), desc(user.id))
    .limit(LIMIT);
}

async function targetOf(id: string) {
  if (!isUuid(id)) throw fail(404, "not_found");
  const [row] = await inJobTx((t) => t.select({ id: user.id, email: user.email }).from(user).where(eq(user.id, id)));
  if (!row) throw fail(404, "not_found");
  return row;
}

adminUserRoutes.post("/users/:id/disable", async (c) => {
  const target = await targetOf(c.req.param("id"));
  if (target.id === c.get("userId") || isAdminEmail(target.email)) throw fail(409, "cannot_disable_admin");
  await inJobTx((t) =>
    t
      .update(user)
      .set({ disabledAt: sql`coalesce(${user.disabledAt}, now())` })
      .where(eq(user.id, target.id)),
  );
  await (await auth.$context).internalAdapter.deleteUserSessions(target.id);
  return c.json({ ok: true });
});

adminUserRoutes.post("/users/:id/enable", async (c) => {
  const target = await targetOf(c.req.param("id"));
  await inJobTx((t) => t.update(user).set({ disabledAt: null }).where(eq(user.id, target.id)));
  return c.json({ ok: true });
});
