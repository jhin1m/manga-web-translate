/**
 * Font tuỳ chỉnh của người dùng: upload TTF/OTF (presigned POST → API kiểm magic bytes, kích thước,
 * parse bằng fontkit rồi lưu metrics), mọi thành viên xem danh sách. Xoá bị chặn khi series còn dùng làm font mặc định.
 * Font đã kiểm được chép sang key theo font_id rồi xoá key upload: presigned POST còn hạn không ghi đè được font đã lưu,
 * và commit lặp trên key upload cũ không tạo được hàng thứ hai dùng chung object.
 */
import { createHash } from "node:crypto";
import { series, userFonts } from "@mtl/db";
import { keyBelongsToUser, storageKeys, userPrefix } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { MAX_FONT_BYTES, readFontInfo, sniffFont } from "../lib/font-metrics.ts";
import { newCustomFontId } from "../lib/fonts.ts";
import { parseJson } from "../lib/validate.ts";
import type { AppEnv } from "../middleware/user.ts";
import { copyObject, deleteObject, head, presignGet, presignPost, readObject } from "../storage.ts";

export const MAX_USER_FONTS = 20;
const UPLOAD_TTL_S = 10 * 60;
/** URL tải font trong danh sách: ngắn; editor tải lại khi gần hết hạn (`url_expires_at`). */
export const FONT_URL_TTL_S = 10 * 60;
const FONT_CONTENT_TYPE = "application/octet-stream";

const UploadRequest = z.object({ bytes: z.number().int().min(1).max(MAX_FONT_BYTES) });
const CommitRequest = z.object({ key: z.string().min(1).max(300) });

type FontRow = typeof userFonts.$inferSelect;

const fail = (status: 400 | 409, error: string, message: string) =>
  new HTTPException(status, { res: Response.json({ error, message }, { status }) });

const fontView = async (f: FontRow) => ({
  id: f.fontId,
  name: f.name,
  bytes: f.bytes,
  units_per_em: f.unitsPerEm,
  ascent: f.ascent,
  descent: f.descent,
  metrics_source: f.metricsSource,
  vi_complete: f.viComplete,
  missing: f.missing,
  url: await presignGet(f.fileKey, FONT_URL_TTL_S),
  url_expires_at: new Date(Date.now() + FONT_URL_TTL_S * 1000).toISOString(),
  created_at: f.createdAt,
});

/** Object upload bị từ chối / trùng → dọn (lỗi dọn chỉ để lại file mồ côi, không làm hỏng phản hồi). */
async function discard(key: string) {
  try {
    await deleteObject(key);
  } catch (err) {
    console.error("[fonts] dọn object upload thất bại", err);
  }
}

export const fontRoutes = new Hono<AppEnv>();

fontRoutes.get("/fonts", async (c) => {
  const rows = await c.get("sdb").select(userFonts);
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return c.json({ fonts: await Promise.all(rows.map(fontView)) });
});

fontRoutes.post("/fonts/upload-url", async (c) => {
  const body = await parseJson(c, UploadRequest);
  const uploadId = uuidv7();
  const key = storageKeys.font(c.get("userId"), uploadId);
  const post = await presignPost(key, FONT_CONTENT_TYPE, body.bytes, UPLOAD_TTL_S);
  return c.json({ upload_id: uploadId, key, url: post.url, fields: post.fields, expires_at: post.expiresAt }, 201);
});

/** Xác nhận font đã upload: kiểm tra rồi lưu. Trùng sha256 trong font của người dùng → trả font có sẵn (200). */
fontRoutes.post("/fonts", async (c) => {
  const { key } = await parseJson(c, CommitRequest);
  const userId = c.get("userId");
  const sdb = c.get("sdb");
  if (!keyBelongsToUser(key, userId) || !key.startsWith(`${userPrefix(userId)}fonts/`)) {
    throw fail(400, "invalid_key", "key không thuộc dữ liệu của bạn");
  }
  const h = await head(key);
  if (!h) throw fail(409, "not_uploaded", "chưa thấy file font đã upload");
  const reject = async (error: string, message: string): Promise<never> => {
    await discard(key);
    throw fail(400, error, message);
  };
  if (h.bytes > MAX_FONT_BYTES) return reject("too_large", "font tối đa 10MB");

  const bytes = await readObject(key);
  if (bytes.length > MAX_FONT_BYTES) return reject("too_large", "font tối đa 10MB");
  if (!sniffFont(bytes)) return reject("not_font", "chỉ nhận font TTF hoặc OTF (không nhận WOFF/WOFF2/TTC)");
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const existing = await sdb.find(userFonts, eq(userFonts.sha256, sha256));
  if (existing) {
    if (existing.fileKey !== key) await discard(key);
    return c.json(await fontView(existing));
  }
  if ((await sdb.select(userFonts)).length >= MAX_USER_FONTS) {
    await discard(key);
    throw fail(409, "limit", `mỗi tài khoản tối đa ${MAX_USER_FONTS} font`);
  }

  let info: ReturnType<typeof readFontInfo>;
  try {
    info = readFontInfo(bytes);
  } catch {
    return reject("corrupt_font", "không đọc được font (file hỏng)");
  }
  const fontId = newCustomFontId();
  const finalKey = storageKeys.font(userId, fontId);
  await copyObject(key, finalKey);
  await discard(key);
  try {
    const row = await sdb.insert(userFonts, {
      fontId,
      name: info.name || `Font ${fontId}`,
      fileKey: finalKey,
      sha256,
      bytes: bytes.length,
      unitsPerEm: info.unitsPerEm,
      ascent: info.ascent,
      descent: info.descent,
      metricsSource: info.metricsSource,
      viComplete: info.viComplete,
      missing: info.missing,
      createdBy: c.get("user").id,
    });
    return c.json(await fontView(row), 201);
  } catch (err) {
    // 2 request cùng font chạy song song: bên thua đụng unique (user, sha256) → trả font bên thắng.
    await discard(finalKey);
    const winner = await sdb.find(userFonts, eq(userFonts.sha256, sha256));
    if (!winner) throw err;
    return c.json(await fontView(winner));
  }
});

fontRoutes.delete("/fonts/:fontId", async (c) => {
  const sdb = c.get("sdb");
  const font = await sdb.find(userFonts, eq(userFonts.fontId, c.req.param("fontId")));
  if (!font) throw new HTTPException(404, { message: "font not found" });
  const users = (await sdb.select(series)).filter((s) => Object.values(s.defaultFonts).includes(font.fontId));
  if (users.length > 0) {
    throw new HTTPException(409, {
      res: Response.json(
        { error: "in_use", message: "font đang là mặc định của series", series: users.map((s) => s.title) },
        { status: 409 },
      ),
    });
  }
  await sdb.delete(userFonts, eq(userFonts.id, font.id));
  await discard(font.fileKey);
  return c.body(null, 204);
});
