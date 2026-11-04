import type { PipelineSettings } from "@mtl/shared";
import { sql } from "drizzle-orm";
import { boolean, check, jsonb, numeric, pgTable, smallint, timestamp, uuid } from "drizzle-orm/pg-core";
import { aiModels } from "./ai-providers.ts";

/**
 * Cài đặt toàn hệ thống (một hàng duy nhất, id = 1). Thiếu hàng = mặc định.
 * `null` ở cột hạn mức / đăng ký = theo biến môi trường tương ứng.
 */
export const systemSettings = pgTable(
  "system_settings",
  {
    id: smallint("id").primaryKey().default(1),
    /** Cài đặt pipeline (có thể thiếu key) — đọc qua `resolvePipelineSettings`; `{}` = mặc định. */
    pipeline: jsonb("pipeline").$type<Partial<PipelineSettings>>().notNull().default({}),
    userDailyUsd: numeric("user_daily_usd"),
    globalDailyUsd: numeric("global_daily_usd"),
    signupEnabled: boolean("signup_enabled"),
    /** Model gán cho từng tác vụ AI; null = mặc định (env worker). RESTRICT: model đang gán không xoá được. */
    ocrModelId: uuid("ocr_model_id").references(() => aiModels.id, { onDelete: "restrict" }),
    translateModelId: uuid("translate_model_id").references(() => aiModels.id, { onDelete: "restrict" }),
    proofreadModelId: uuid("proofread_model_id").references(() => aiModels.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("system_settings_singleton_chk", sql`${t.id} = 1`)],
);
