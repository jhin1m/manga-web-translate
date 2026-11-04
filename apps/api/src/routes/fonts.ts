/**
 * Font tuỳ chỉnh của người dùng: upload TTF/OTF (presigned POST → API kiểm magic bytes, kích thước,
 * parse bằng fontkit rồi lưu metrics), mọi thành viên xem danh sách. Xoá bị chặn khi series còn dùng làm font mặc định.
 * Font đã kiểm được chép sang key theo font_id rồi xoá key upload: presigned POST còn hạn không ghi đè được font đã lưu,
 * và commit lặp trên key upload cũ không tạo được hàng thứ hai dùng chung object.
 */
import { series, systemFonts, userFonts } from "@mtl/db";
import { keyBelongsToUser, storageKeys, userPrefix } from "@mtl/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { inJobTx } from "../jobs/enqueue.ts";
import { MAX_FONT_BYTES } from "../lib/font-metrics.ts";
import { discardUpload, fail, fontView, inspectUploadedFont } from "../lib/font-upload.ts";
import { allocateCustomFontId } from "../lib/fonts.ts";
import { parseJson } from "../lib/validate.ts";
import type { AppEnv } from "../middleware/user.ts";
import { copyObject, presignPost } from "../storage.ts";

export const MAX_USER_FONTS = 20;
const UPLOAD_TTL_S = 10 * 60;
const FONT_CONTENT_TYPE = "application/octet-stream";

const UploadRequest = z.object({ bytes: z.number().int().min(1).max(MAX_FONT_BYTES) });
const CommitRequest = z.object({ key: z.string().min(1).max(300) });

export const fontRoutes = new Hono<AppEnv>();

fontRoutes.get("/fonts", async (c) => {
  const sdb = c.get("sdb");
  const [system, own] = await Promise.all([sdb.selectShared(systemFonts), sdb.select(userFonts)]);
  const byAge = <T extends { createdAt: Date }>(a: T, b: T) => a.createdAt.getTime() - b.createdAt.getTime();
  // Font hệ thống đứng trước; giới hạn MAX_USER_FONTS chỉ tính font riêng.
  const fonts = [
    ...system.sort(byAge).map((f) => fontView(f, true)),
    ...own.sort(byAge).map((f) => fontView(f, false)),
  ];
  return c.json({ fonts: await Promise.all(fonts) });
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
  const font = await inspectUploadedFont(key);
  const { bytes, sha256 } = font;

  const existing = await sdb.find(userFonts, eq(userFonts.sha256, sha256));
  if (existing) {
    if (existing.fileKey !== key) await discardUpload(key);
    return c.json(await fontView(existing, false));
  }
  if ((await sdb.select(userFonts)).length >= MAX_USER_FONTS) {
    await discardUpload(key);
    throw fail(409, "limit", `mỗi tài khoản tối đa ${MAX_USER_FONTS} font`);
  }

  const info = await font.info();
  const fontId = await inJobTx(allocateCustomFontId);
  const finalKey = storageKeys.font(userId, fontId);
  await copyObject(key, finalKey);
  await discardUpload(key);
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
    return c.json(await fontView(row, false), 201);
  } catch (err) {
    // 2 request cùng font chạy song song: bên thua đụng unique (user, sha256) → trả font bên thắng.
    await discardUpload(finalKey);
    const winner = await sdb.find(userFonts, eq(userFonts.sha256, sha256));
    if (!winner) throw err;
    return c.json(await fontView(winner, false));
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
  await discardUpload(font.fileKey);
  return c.body(null, 204);
});
