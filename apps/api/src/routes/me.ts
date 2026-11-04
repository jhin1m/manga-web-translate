import { Hono } from "hono";
import { userQuotaStatus } from "../billing/user-quota.ts";
import { inJobTx } from "../jobs/enqueue.ts";
import { isAdminEmail } from "../middleware/admin.ts";
import type { AppEnv } from "../middleware/user.ts";

export const meRoutes = new Hono<AppEnv>();

/**
 * Người đang đăng nhập + quyền admin (`ADMIN_EMAILS`) + hạn mức chi phí hôm nay (`limit_usd` null = không giới hạn).
 */
meRoutes.get("/me", async (c) => {
  const user = c.get("user");
  const quota = await inJobTx((tx) => userQuotaStatus(tx, user.id));
  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    is_admin: isAdminEmail(user.email),
    quota: { spent_usd: quota.spent_usd, limit_usd: quota.limit_usd, resets_at: quota.resets_at },
  });
});
