import { user } from "@mtl/db";
import { UI_LOCALES } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { userQuotaStatus } from "../billing/user-quota.ts";
import { inJobTx } from "../jobs/enqueue.ts";
import { parseJson } from "../lib/validate.ts";
import { isAdminEmail } from "../middleware/admin.ts";
import type { AppEnv } from "../middleware/user.ts";

export const meRoutes = new Hono<AppEnv>();

/**
 * Người đang đăng nhập + quyền admin (`ADMIN_EMAILS`) + hạn mức chi phí hôm nay (`limit_usd` null = không giới hạn) +
 * ngôn ngữ giao diện đã đồng bộ (`ui_locale` null = chưa từng gửi). Đọc `ui_locale` từ DB, không từ phiên: chế độ
 * local giữ user trong bộ nhớ từ lúc boot.
 */
meRoutes.get("/me", async (c) => {
  const u = c.get("user");
  const { quota, uiLocale } = await inJobTx(async (tx) => {
    const [row] = await tx.select({ uiLocale: user.uiLocale }).from(user).where(eq(user.id, u.id));
    return { quota: await userQuotaStatus(tx, u.id), uiLocale: row?.uiLocale ?? null };
  });
  return c.json({
    id: u.id,
    email: u.email,
    name: u.name,
    is_admin: isAdminEmail(u.email),
    quota: { spent_usd: quota.spent_usd, limit_usd: quota.limit_usd, resets_at: quota.resets_at },
    ui_locale: uiLocale,
  });
});

const LocaleBody = z.object({ ui_locale: z.enum(UI_LOCALES) }).strict();

/** Web gửi khi người dùng đổi ngôn ngữ giao diện (và lúc mở app nếu khác server) — job enqueue sau đó mang `ui_lang`. */
meRoutes.put("/me/locale", async (c) => {
  const body = await parseJson(c, LocaleBody);
  const userId = c.get("userId");
  await inJobTx((tx) => tx.update(user).set({ uiLocale: body.ui_locale }).where(eq(user.id, userId)));
  return c.json({ ui_locale: body.ui_locale });
});
