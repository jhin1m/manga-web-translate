/**
 * Font dùng được của người dùng = font gói sẵn (worker/fonts/manifest.json — worker vẽ, editor đo theo đó) +
 * font tuỳ chỉnh đã upload (`user_fonts`, id dạng `custom-<8 hex>`).
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Scoped, userFonts } from "@mtl/db";
import { inArray } from "drizzle-orm";

const manifest = JSON.parse(
  readFileSync(new URL("../../../../worker/fonts/manifest.json", import.meta.url), "utf8"),
) as {
  defaults: string[];
  fonts: Record<string, unknown>;
};

export const BUNDLED_FONT_IDS: readonly string[] = Object.keys(manifest.fonts).sort();
export const CUSTOM_FONT_PREFIX = "custom-";

export const newCustomFontId = () => `${CUSTOM_FONT_PREFIX}${randomBytes(4).toString("hex")}`;

/** Id có thuộc font tuỳ chỉnh (theo dạng) — chưa nói font có tồn tại không. */
export const isCustomFontId = (id: string) => /^custom-[0-9a-f]{8}$/.test(id);

/** Trong những `ids` (không trùng), id nào không phải font gói sẵn cũng không phải font của người dùng. */
export async function unknownFonts(sdb: Scoped, ids: string[]): Promise<string[]> {
  const custom = [...new Set(ids)].filter((id) => !BUNDLED_FONT_IDS.includes(id));
  if (custom.length === 0) return [];
  const have = new Set((await sdb.select(userFonts, inArray(userFonts.fontId, custom))).map((f) => f.fontId));
  return custom.filter((id) => !have.has(id));
}

export async function isKnownFont(sdb: Scoped, id: string): Promise<boolean> {
  return (await unknownFonts(sdb, [id])).length === 0;
}

export type CustomFontRef = { id: string; file_key: string; sha256: string };

/**
 * Font tuỳ chỉnh (file_key + sha256) cho job: chỉ những id của người dùng, bỏ qua id gói sẵn / đã xoá / lạ
 * (worker và editor fallback font mặc định cho id không thấy).
 */
export async function resolveCustomFonts(sdb: Scoped, ids: Iterable<string | undefined>): Promise<CustomFontRef[]> {
  const wanted = [...new Set([...ids].filter((id): id is string => !!id && isCustomFontId(id)))];
  if (wanted.length === 0) return [];
  const rows = await sdb.select(userFonts, inArray(userFonts.fontId, wanted));
  return rows
    .map((r) => ({ id: r.fontId, file_key: r.fileKey, sha256: r.sha256 }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
