/**
 * Gợi ý thuật ngữ / xưng hô AI học được khi dịch (xem lib/series-memory.ts). "Nhận" không có route riêng: người dùng
 * thêm entry qua route glossary hoặc lưu pronoun_rules qua PATCH series có sẵn, server tự ẩn gợi ý đã có khi đọc.
 * Chỉ có đọc danh sách và "Bỏ".
 */
import { series, seriesSuggestions } from "@mtl/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { listSuggestions } from "../lib/series-memory.ts";
import { parseJson } from "../lib/validate.ts";
import type { AppEnv } from "../middleware/user.ts";

export const seriesSuggestionRoutes = new Hono<AppEnv>();

seriesSuggestionRoutes.get("/series/:seriesId/suggestions", async (c) => {
  const sdb = c.get("sdb");
  const s = await sdb.byId(series, c.req.param("seriesId"), "series");
  return c.json(await listSuggestions(sdb, s));
});

/** "Bỏ" gợi ý (dismissed: false = hoàn tác). */
seriesSuggestionRoutes.patch("/series-suggestions/:suggestionId", async (c) => {
  const body = await parseJson(c, z.object({ dismissed: z.boolean() }));
  const sdb = c.get("sdb");
  const row = await sdb.byId(seriesSuggestions, c.req.param("suggestionId"), "suggestion");
  await sdb.update(seriesSuggestions, eq(seriesSuggestions.id, row.id), {
    dismissedAt: body.dismissed ? new Date() : null,
  });
  return c.json({ id: row.id, dismissed: body.dismissed });
});
