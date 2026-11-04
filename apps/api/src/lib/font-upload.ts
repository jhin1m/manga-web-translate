/**
 * Phần kiểm file font dùng chung cho font riêng (`routes/fonts.ts`) và font hệ thống (`routes/admin-fonts.ts`):
 * đọc object đã upload, kiểm kích thước / magic bytes / sha256 / parse, và dạng JSON trả về cho client.
 */
import { createHash } from "node:crypto";
import type { systemFonts } from "@mtl/db";
import { HTTPException } from "hono/http-exception";
import { deleteObject, head, presignGet, readObject } from "../storage.ts";
import { MAX_FONT_BYTES, readFontInfo, sniffFont } from "./font-metrics.ts";

/** URL tải font trong danh sách: ngắn; editor tải lại khi gần hết hạn (`url_expires_at`). */
export const FONT_URL_TTL_S = 10 * 60;

export const fail = (status: 400 | 409, error: string, message: string) =>
  new HTTPException(status, { res: Response.json({ error, message }, { status }) });

/** Object upload bị từ chối / trùng → dọn (lỗi dọn chỉ để lại file mồ côi, không làm hỏng phản hồi). */
export async function discardUpload(key: string) {
  try {
    await deleteObject(key);
  } catch (err) {
    console.error("[fonts] dọn object upload thất bại", err);
  }
}

export type FontInfo = ReturnType<typeof readFontInfo>;
export type InspectedFont = { bytes: Uint8Array; sha256: string; info: () => Promise<FontInfo> };

/**
 * Kiểm object đã upload ở `key`: 409 `not_uploaded` nếu chưa thấy; `too_large` / `not_font` → 400 và xoá object.
 * `info()` parse font (ném 400 `corrupt_font` + xoá object) — gọi sau khi đã kiểm trùng sha256 / giới hạn để font trùng
 * không tốn công parse.
 */
export async function inspectUploadedFont(key: string): Promise<InspectedFont> {
  const reject = async (error: string, message: string): Promise<never> => {
    await discardUpload(key);
    throw fail(400, error, message);
  };
  const h = await head(key);
  if (!h) throw fail(409, "not_uploaded", "chưa thấy file font đã upload");
  if (h.bytes > MAX_FONT_BYTES) return reject("too_large", "font tối đa 10MB");

  const bytes = await readObject(key);
  if (bytes.length > MAX_FONT_BYTES) return reject("too_large", "font tối đa 10MB");
  if (!sniffFont(bytes)) return reject("not_font", "chỉ nhận font TTF hoặc OTF (không nhận WOFF/WOFF2/TTC)");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    bytes,
    sha256,
    info: async () => {
      try {
        return readFontInfo(bytes);
      } catch {
        return reject("corrupt_font", "không đọc được font (file hỏng)");
      }
    },
  };
}

/** Cột chung của `user_fonts` và `system_fonts` (dòng font riêng gán được vào đây). */
export type FontRow = typeof systemFonts.$inferSelect;

export const fontView = async (f: FontRow, system: boolean) => ({
  id: f.fontId,
  name: f.name,
  bytes: f.bytes,
  units_per_em: f.unitsPerEm,
  ascent: f.ascent,
  descent: f.descent,
  metrics_source: f.metricsSource,
  vi_complete: f.viComplete,
  missing: f.missing,
  system,
  url: await presignGet(f.fileKey, FONT_URL_TTL_S),
  url_expires_at: new Date(Date.now() + FONT_URL_TTL_S * 1000).toISOString(),
  created_at: f.createdAt,
});
