import { aiModels } from "@mtl/db";
import { AI_TASK_SLOTS, AiSlots, PipelineSettings, VISION_SLOTS } from "@mtl/shared";
import { inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { activeLlmJobs, llmJobsOverUserLimit, todaySpend } from "../billing/user-quota.ts";
import { env } from "../env.ts";
import { inJobTx } from "../jobs/enqueue.ts";
import { fail } from "../lib/ai-providers.ts";
import {
  effectiveLimits,
  lockSystemSettings,
  resolveLimits,
  saveLimits,
  saveSlots,
  saveSystemPipeline,
  storedLimits,
  systemPipeline,
  systemSlots,
} from "../lib/system-settings.ts";
import { parseJson } from "../lib/validate.ts";
import type { AppEnv } from "../middleware/user.ts";

export const adminSettingsRoutes = new Hono<AppEnv>();

const toApi = (e: Awaited<ReturnType<typeof effectiveLimits>>) => ({
  user_daily_usd: e.userDailyUsd,
  global_daily_usd: e.globalDailyUsd,
  signup_enabled: e.signupEnabled,
  signup_open: e.signupOpen,
});

/**
 * Cài đặt toàn hệ thống: pipeline, 3 slot model AI, hạn mức (`limits` = giá trị lưu, null = theo env; `effective` =
 * sau fallback env), `env` (mặc định khi trống) và chi tiêu hôm nay.
 */
adminSettingsRoutes.get("/settings", async (c) => {
  const out = await inJobTx(async (tx) => ({
    pipeline: await systemPipeline(tx),
    slots: await systemSlots(tx),
    limits: await storedLimits(tx),
    effective: toApi(await effectiveLimits(tx)),
    today: await todaySpend(tx),
  }));
  // `env` = giá trị mặc định khi ô để trống (UI dùng làm placeholder và để biết có bật đăng ký được không).
  return c.json({
    ...out,
    env: {
      user_daily_usd: env.USER_DAILY_USD ?? null,
      global_daily_usd: env.GLOBAL_DAILY_USD ?? null,
      signup_enabled: env.SIGNUP_ENABLED,
    },
  });
});

const Usd = z.number().finite().min(0).nullable();
const LimitsBody = z.object({
  user_daily_usd: Usd,
  global_daily_usd: Usd,
  signup_enabled: z.boolean().nullable(),
  confirm: z.boolean().optional(),
});

/** Hạ xuống mức mới và mức đó đã bị chạm hôm nay (hoặc = 0) → hậu quả tức thì, cần xác nhận. */
const lowersBelowSpend = (current: number | null, next: number | null, spent: number) =>
  next !== null && (current === null || next < current) && (next === 0 || spent >= next);

/**
 * Lưu đủ bộ hạn mức USD/ngày + đăng ký (null = theo env), có hiệu lực ở lần đánh giá kế. Chạy dưới khoá hàng cài đặt.
 * - bật đăng ký mà thiếu 1 trong 2 hạn mức hiệu lực → 409 `limits_required`;
 * - hạ hạn mức xuống mức đã chi hôm nay mà thiếu `confirm: true` → 409 `confirm_required` (kèm số liệu + số job).
 */
adminSettingsRoutes.put("/settings/limits", async (c) => {
  const body = await parseJson(c, LimitsBody);
  const out = await inJobTx(async (tx) => {
    await lockSystemSettings(tx);
    const cur = await effectiveLimits(tx);
    const next = resolveLimits(body);
    if (next.signupEnabled && (next.userDailyUsd === null || next.globalDailyUsd === null)) {
      throw fail(409, "limits_required");
    }
    if (!body.confirm) {
      const today = await todaySpend(tx);
      const userOver = lowersBelowSpend(cur.userDailyUsd, next.userDailyUsd, today.max_user_spent_usd);
      const globalOver = lowersBelowSpend(cur.globalDailyUsd, next.globalDailyUsd, today.global_spent_usd);
      if (userOver || globalOver) {
        throw fail(409, "confirm_required", {
          ...today,
          user_over: userOver,
          global_over: globalOver,
          user_jobs: userOver && next.userDailyUsd !== null ? await llmJobsOverUserLimit(tx, next.userDailyUsd) : null,
          global_jobs: globalOver ? await activeLlmJobs(tx) : null,
        });
      }
    }
    await saveLimits(tx, body);
    return { limits: await storedLimits(tx), effective: toApi(await effectiveLimits(tx)) };
  });
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
