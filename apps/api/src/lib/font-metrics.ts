/**
 * Đọc font tuỳ chỉnh bằng fontkit, cho ra metrics ĐÚNG quy tắc của worker/mtl_pipeline/fonts.py `read_metrics`
 * (editor đo, worker vẽ — lệch là lệch layout): OS/2 có cờ USE_TYPO_METRICS → sTypoAscender/Descender, ngược lại
 * hhea ascent/descent; unitsPerEm từ head. Độ phủ chữ Việt theo `vietnameseChars()` (cùng danh sách với worker).
 */
import { vietnameseChars } from "@mtl/shared";
import { create } from "fontkit";

export type FontInfo = {
  name: string;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  metricsSource: "OS/2.typo" | "hhea";
  viComplete: boolean;
  missing: string[];
};

export const MAX_FONT_BYTES = 10 * 1024 * 1024;

const tag = (b: Uint8Array) => String.fromCharCode(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0);

/** TTF (sfnt 0x00010000 / 'true') hoặc OTF ('OTTO'). WOFF/WOFF2/TTC → null (Pillow trong worker không đọc được). */
export function sniffFont(prefix: Uint8Array): "ttf" | "otf" | null {
  if (prefix.length < 4) return null;
  const t = tag(prefix);
  if (t === "\0\x01\0\0" || t === "true") return "ttf";
  if (t === "OTTO") return "otf";
  return null;
}

/** Ném lỗi nếu font hỏng/thiếu bảng bắt buộc — caller bắt và trả 400. */
export function readFontInfo(bytes: Uint8Array): FontInfo {
  const font = create(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  if (!("unitsPerEm" in font) || "fonts" in font) throw new Error("font collection không được hỗ trợ");
  const upm = font.unitsPerEm;
  if (!Number.isInteger(upm) || upm < 16 || upm > 16384) throw new Error(`unitsPerEm không hợp lệ: ${upm}`);

  const os2 = font["OS/2"] as {
    fsSelection?: { useTypoMetrics?: boolean };
    typoAscender: number;
    typoDescender: number;
  };
  const typo = os2?.fsSelection?.useTypoMetrics === true;
  const hhea = font.hhea as { ascent: number; descent: number };
  const ascent = typo ? os2.typoAscender : hhea.ascent;
  const descent = -(typo ? os2.typoDescender : hhea.descent);
  if (![ascent, descent].every(Number.isFinite) || ascent + descent <= 0) throw new Error("metrics font không hợp lệ");

  const missing = [...new Set(vietnameseChars())].filter((ch) => !font.hasGlyphForCodePoint(ch.codePointAt(0) ?? 0));
  const name = (font.fullName || font.familyName || font.postscriptName || "").trim().slice(0, 100);
  return {
    name,
    unitsPerEm: upm,
    ascent,
    descent,
    metricsSource: typo ? "OS/2.typo" : "hhea",
    viComplete: missing.length === 0,
    missing,
  };
}
