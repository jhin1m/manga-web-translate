import { aiModels } from "@mtl/db";
import { AI_TASK_SLOTS, AiSlots, PipelineSettings, VISION_SLOTS } from "@mtl/shared";
import { inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { inJobTx } from "../jobs/enqueue.ts";
import { fail } from "../lib/ai-providers.ts";
import {
  lockSystemSettings,
  saveSlots,
  saveSystemPipeline,
  systemPipeline,
  systemSlots,
} from "../lib/system-settings.ts";
import { parseJson } from "../lib/validate.ts";
import type { AppEnv } from "../middleware/user.ts";

export const adminSettingsRoutes = new Hono<AppEnv>();

/** Cài đặt toàn hệ thống: pipeline + 3 slot model AI. Hạn mức / đăng ký chỉ cấu hình trong `.env`. */
adminSettingsRoutes.get("/settings", async (c) => {
  const out = await inJobTx(async (tx) => ({
    pipeline: await systemPipeline(tx),
    slots: await systemSlots(tx),
  }));
  return c.json(out);
});

/**
 * Cài đặt pipeline chung (detector, OCR engine theo ngôn ngữ nguồn, inpainter, nâng cao, model hiệu đính).
 * Lưu đủ bộ; có hiệu lực từ job enqueue sau (job đang chờ giữ snapshot cũ).
 */
adminSettingsRoutes.put("/settings/pipeline", async (c) => {
  const body = await parseJson(c, z.object({ pipeline: PipelineSettings }));
  const pipeline = await inJobTx((tx) => saveSystemPipeline(tx, body.pipeline));
  return c.json({ pipeline });
});

/**
 * Gán model cho 3 tác vụ (đủ bộ; null = mặc định env worker). OCR + Hiệu đính cần model có vision.
 * Chạy dưới khoá hàng cài đặt → không đua với xoá provider / model.
 */
adminSettingsRoutes.put("/settings/slots", async (c) => {
  const body = await parseJson(c, AiSlots);
  const ids = [...new Set(AI_TASK_SLOTS.map((s) => body[s]).filter((v): v is string => v !== null))];
  const slots = await inJobTx(async (tx) => {
    await lockSystemSettings(tx);
    const rows = ids.length ? await tx.select().from(aiModels).where(inArray(aiModels.id, ids)) : [];
    const byId = new Map(rows.map((m) => [m.id, m]));
    for (const slot of AI_TASK_SLOTS) {
      const id = body[slot];
      if (id === null) continue;
      const model = byId.get(id);
      if (!model) throw fail(400, "model_not_found", { slot });
      if (VISION_SLOTS.includes(slot) && !model.vision) throw fail(400, "model_not_vision", { slot });
    }
    return saveSlots(tx, body);
  });
  return c.json({ slots });
});
