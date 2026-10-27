import { userSettings } from "@mtl/db";
import { PipelineSettings, resolvePipelineSettings } from "@mtl/shared";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { userQuotaStatus } from "../billing/user-quota.ts";
import { inJobTx } from "../jobs/enqueue.ts";
import { parseJson } from "../lib/validate.ts";
import type { AppEnv } from "../middleware/user.ts";

export const meRoutes = new Hono<AppEnv>();

/**
 * Người đang đăng nhập + cài đặt chung (thiếu dòng user_settings = mặc định) + hạn mức chi phí hôm nay
 * (`limit_usd` null = không giới hạn).
 */
meRoutes.get("/me", async (c) => {
  const user = c.get("user");
  const [settings, quota] = await Promise.all([
    c.get("sdb").find(userSettings),
    inJobTx((tx) => userQuotaStatus(tx, user.id)),
  ]);
  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    settings: { pipeline: resolvePipelineSettings(settings?.pipeline) },
    quota: { spent_usd: quota.spent_usd, limit_usd: quota.limit_usd, resets_at: quota.resets_at },
  });
});

/**
 * Cài đặt pipeline (detector, OCR engine theo ngôn ngữ nguồn, inpainter, nâng cao, model hiệu đính).
 * Lưu đủ bộ; có hiệu lực từ job enqueue sau (job đang chờ giữ snapshot cũ).
 */
meRoutes.put("/settings/pipeline", async (c) => {
  const body = await parseJson(c, z.object({ pipeline: PipelineSettings }));
  // Upsert: 2 lần lưu đầu tiên cùng lúc (2 tab) không đụng khoá chính.
  const [saved] = await inJobTx((tx) =>
    tx
      .insert(userSettings)
      .values({ userId: c.get("userId"), pipeline: body.pipeline })
      .onConflictDoUpdate({ target: userSettings.userId, set: { pipeline: body.pipeline, updatedAt: sql`now()` } })
      .returning(),
  );
  return c.json({ pipeline: resolvePipelineSettings(saved?.pipeline) });
});
