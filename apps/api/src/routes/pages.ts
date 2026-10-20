/**
 * Danh sách page của chương cho lưới thumbnail: ảnh sạch rev hiện tại khi có, fallback ảnh gốc sau ingest.
 * `images` = cả ảnh gốc lẫn ảnh sạch (canvas màn chương vẽ từng page, so sánh gốc/dịch); `image` giữ cho client cũ.
 * URL là presigned GET TTL ngắn trên FILES_DOMAIN (bucket private) — tách khỏi /progress để polling 2–3s
 * không ký lại URL mỗi lượt.
 */
import { chapters, pages } from "@mtl/db";
import { storageKeys } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { type AppEnv, requireWorkspace } from "../middleware/workspace.ts";
import { MAX_GET_TTL_S, presignGet } from "../storage.ts";

const THUMB_TTL_S = MAX_GET_TTL_S;

export const pageRoutes = new Hono<AppEnv>();

pageRoutes.get("/w/:ws/chapters/:chapterId/pages", requireWorkspace(), async (c) => {
  const sdb = c.get("sdb");
  const ws = c.get("workspaceId");
  const ch = await sdb.byId(chapters, c.req.param("chapterId"), "chapter");
  const rows = await sdb.select(pages, eq(pages.chapterId, ch.id));
  rows.sort((a, b) => a.ord - b.ord);
  const expiresAt = new Date(Date.now() + THUMB_TTL_S * 1000);
  return c.json({
    expires_at: expiresAt,
    pages: await Promise.all(
      rows.map(async (p) => {
        const [original, clean] = await Promise.all([
          presignGet(p.originalKey, THUMB_TTL_S),
          p.cleanRev !== null ? presignGet(storageKeys.clean(ws, p.id, p.cleanRev), THUMB_TTL_S) : null,
        ]);
        return {
          id: p.id,
          ord: p.ord,
          width: p.width,
          height: p.height,
          status: p.status,
          clean_rev: p.cleanRev,
          cut_flag: p.cutFlag,
          image: { kind: clean !== null ? "clean" : "original", url: clean ?? original },
          images: { original, clean },
        };
      }),
    ),
  });
});
