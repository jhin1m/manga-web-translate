/**
 * Danh sách gợi ý AI cũ: AI giờ ghi thẳng vào glossary / xưng hô / Giọng văn (lib/series-memory.ts), nên route chỉ
 * còn trả danh sách rỗng. Giữ một bản cho tab web cũ chưa tải lại (không lỗi 404).
 */
import { series } from "@mtl/db";
import { Hono } from "hono";
import type { AppEnv } from "../middleware/user.ts";

export const seriesSuggestionRoutes = new Hono<AppEnv>();

seriesSuggestionRoutes.get("/series/:seriesId/suggestions", async (c) => {
  await c.get("sdb").byId(series, c.req.param("seriesId"), "series");
  return c.json({ terms: [], pronouns: [] });
});
