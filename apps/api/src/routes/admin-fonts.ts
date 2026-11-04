/**
 * Font hệ thống (admin): TTF/OTF dùng chung cho mọi người dùng, cùng luồng upload / kiểm tra với font riêng
 * (`lib/font-upload.ts`) và cùng dạng id `custom-<8 hex>` nên hợp đồng job không đổi. Trần: 20 font hoặc tổng 100MB.
 * Xoá bị chặn khi series của bất kỳ ai còn dùng làm font mặc định (chỉ trả số series, không lộ tên).
 */
import { series, systemFonts } from "@mtl/db";
import { storageKeys } from "@mtl/shared";
import { asc, count, eq, sql, sum } from "drizzle-orm";
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

export const MAX_SYSTEM_FONTS = 20;
export const MAX_SYSTEM_FONT_BYTES = 100 * 1024 * 1024;
const UPLOAD_TTL_S = 10 * 60;
const UPLOAD_PREFIX = storageKeys.systemFontUpload("");
// Khoá advisory cho "kiểm trần rồi chèn" (2 commit song song không cùng vượt trần).

const UploadRequest = z.object({ bytes: z.number().int().min(1).max(MAX_FONT_BYTES) });
const CommitRequest = z.object({ key: z.string().min(1).max(300) });

export const adminFontRoutes = new Hono<AppEnv>();

adminFontRoutes.get("/fonts", async (c) => {
  const rows = await inJobTx((t) => t.select().from(systemFonts).orderBy(asc(systemFonts.createdAt)));
  return c.json({ fonts: await Promise.all(rows.map((f) => fontView(f, true))) });
});

adminFontRoutes.post("/fonts/upload-url", async (c) => {
  const body = await parseJson(c, UploadRequest);
  const uploadId = uuidv7();
  const key = storageKeys.systemFontUpload(uploadId);
  const post = await presignPost(key, "application/octet-stream", body.bytes, UPLOAD_TTL_S);
  return c.json({ upload_id: uploadId, key, url: post.url, fields: post.fields, expires_at: post.expiresAt }, 201);
});

/** Xác nhận font đã upload. Trùng sha256 → trả font có sẵn (200); chạm trần → 409 `limit`. */
adminFontRoutes.post("/fonts", async (c) => {
  const { key } = await parseJson(c, CommitRequest);
  if (!key.startsWith(UPLOAD_PREFIX) || key.includes("..")) {
    throw fail(400, "invalid_key", "key không phải file upload font hệ thống");
  }
  const font = await inspectUploadedFont(key);
  const { bytes, sha256 } = font;
  const sameSha = (t: Parameters<Parameters<typeof inJobTx>[0]>[0]) =>
    t.select().from(systemFonts).where(eq(systemFonts.sha256, sha256));

  const [existing] = await inJobTx(sameSha);
  if (existing) {
    await discardUpload(key);
    return c.json(await fontView(existing, true));
  }
  const info = await font.info();
  const fontId = await inJobTx(allocateCustomFontId);
  const finalKey = storageKeys.systemFont(fontId);
  await copyObject(key, finalKey);
  await discardUpload(key);

  const outcome = await inJobTx(async (t) => {
    await t.execute(sql`select pg_advisory_xact_lock(hashtext('mtl_system_fonts_cap'))`);
    const [dup] = await sameSha(t);
    if (dup) return { kind: "dup" as const, row: dup };
    const [total] = await t.select({ n: count(), bytes: sum(systemFonts.bytes) }).from(systemFonts);
    if ((total?.n ?? 0) >= MAX_SYSTEM_FONTS || Number(total?.bytes ?? 0) + bytes.length > MAX_SYSTEM_FONT_BYTES) {
      return { kind: "limit" as const };
    }
    const [row] = await t
      .insert(systemFonts)
      .values({
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
      })
      .returning();
    return { kind: "created" as const, row: row as NonNullable<typeof row> };
  }).catch(async (err) => {
    await discardUpload(finalKey);
    throw err;
  });

  if (outcome.kind === "limit") {
    await discardUpload(finalKey);
    throw fail(409, "limit", `font hệ thống tối đa ${MAX_SYSTEM_FONTS} font hoặc ${MAX_SYSTEM_FONT_BYTES >> 20}MB`);
  }
  if (outcome.kind === "dup") {
    await discardUpload(finalKey);
    return c.json(await fontView(outcome.row, true));
  }
  return c.json(await fontView(outcome.row, true), 201);
});

adminFontRoutes.delete("/fonts/:fontId", async (c) => {
  const fontId = c.req.param("fontId");
  const result = await inJobTx(async (t) => {
    const [font] = await t.select().from(systemFonts).where(eq(systemFonts.fontId, fontId));
    if (!font) return null;
    const [used] = await t
      .select({ n: count() })
      .from(series)
      .where(sql`exists (select 1 from jsonb_each_text(${series.defaultFonts}) where value = ${fontId})`);
    const inUse = used?.n ?? 0;
    if (inUse === 0) await t.delete(systemFonts).where(eq(systemFonts.id, font.id));
    return { font, inUse };
  });
  if (!result) throw new HTTPException(404, { message: "font not found" });
  if (result.inUse > 0) {
    throw new HTTPException(409, {
      res: Response.json(
        { error: "in_use", message: "font đang là mặc định của series", series_count: result.inUse },
        { status: 409 },
      ),
    });
  }
  await discardUpload(result.font.fileKey);
  return c.body(null, 204);
});
