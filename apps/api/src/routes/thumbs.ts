/**
 * Thumbnail WebP của ảnh gốc, tạo khi có người xem rồi cache trong storage: lần đầu đọc ảnh gốc → sharp → ghi
 * `storageKeys.thumb`, các lần sau chỉ ký lại URL. Trả 302 tới URL ký để trình duyệt tải thẳng từ storage.
 */
import { sourceFiles } from "@mtl/db";
import { storageKeys } from "@mtl/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ImageError, renderThumb } from "../lib/thumbnails.ts";
import type { AppEnv } from "../middleware/user.ts";
import { head, MAX_GET_TTL_S, presignGet, putObject, readObject } from "../storage.ts";
import { MAX_FILE_BYTES } from "./chapters.ts";

/** Ngắn hơn TTL link ký (15') để trình duyệt không giữ redirect tới link đã hết hạn. */
const REDIRECT_CACHE_S = 600;

export const thumbRoutes = new Hono<AppEnv>();

thumbRoutes.get("/thumbs/:fileId", async (c) => {
  const f = await c.get("sdb").byId(sourceFiles, c.req.param("fileId"), "source file");
  const trim = f.trim ?? { top: 0, bottom: 0 };
  const key = storageKeys.thumb(f.userId, f.chapterId, f.id, trim.top, trim.bottom);

  if (!(await head(key))) {
    const src = await head(f.storageKey);
    // Chưa upload xong (hoặc đã bị dọn): web hiện placeholder.
    if (!src || src.bytes < 1 || src.bytes > MAX_FILE_BYTES) {
      throw new HTTPException(404, {
        res: Response.json({ error: "not_uploaded", message: "ảnh chưa có" }, { status: 404 }),
      });
    }
    try {
      const webp = await renderThumb(() => readObject(f.storageKey), trim);
      await putObject(key, webp, "image/webp");
    } catch (err) {
      if (err instanceof ImageError) {
        throw new HTTPException(422, {
          res: Response.json({ error: err.code, message: err.message }, { status: 422 }),
        });
      }
      throw err;
    }
  }

  c.header("Cache-Control", `private, max-age=${REDIRECT_CACHE_S}`);
  return c.redirect(await presignGet(key, MAX_GET_TTL_S), 302);
});
