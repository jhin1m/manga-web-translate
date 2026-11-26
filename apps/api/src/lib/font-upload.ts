/**
 * Phần kiểm file font dùng chung cho font riêng (`routes/fonts.ts`) và font hệ thống (`routes/admin-fonts.ts`):
 * đọc object đã upload, kiểm kích thước / magic bytes / sha256 / parse, và dạng JSON trả về cho client.
 */
import { createHash } from "node:crypto";
import type { systemFonts } from "@mtl/db";
import type { HTTPException } from "hono/http-exception";
import { deleteObject, head, presignGet, readObject } from "../storage.ts";
import { apiError } from "./api-error.ts";
import { MAX_FONT_BYTES, readFontInfo, sniffFont } from "./font-metrics.ts";

/** URL tải font trong danh sách: ngắn; editor tải lại khi gần hết hạn (`url_expires_at`). */
export const FONT_URL_TTL_S = 10 * 60;

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
  const reject = async (error: HTTPException): Promise<never> => {
    await discardUpload(key);
    throw error;
  };
  const tooLarge = () => apiError(400, "too_large.font", { max_mb: MAX_FONT_BYTES >> 20 });
  const h = await head(key);
  if (!h) throw apiError(409, "not_uploaded.font");
  if (h.bytes > MAX_FONT_BYTES) return reject(tooLarge());

  const bytes = await readObject(key);
  if (bytes.length > MAX_FONT_BYTES) return reject(tooLarge());
  if (!sniffFont(bytes)) return reject(apiError(400, "not_font"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    bytes,
    sha256,
    info: async () => {
      try {
        return readFontInfo(bytes);
      } catch {
        return reject(apiError(400, "corrupt_font"));
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
