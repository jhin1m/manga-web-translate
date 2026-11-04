/**
 * Font dùng được của người dùng = font gói sẵn (worker/fonts/manifest.json — worker vẽ, editor đo theo đó) +
 * font hệ thống do admin upload (`system_fonts`) + font riêng đã upload (`user_fonts`); hai bảng sau dùng chung dạng id
 * `custom-<8 hex>` (không trùng nhau) nên worker không phân biệt.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { type DbLike, type Scoped, systemFonts, userFonts } from "@mtl/db";
import { eq, inArray } from "drizzle-orm";

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

/** Font hệ thống trong `ids` (đã lọc dạng id). */
const systemFontRows = (sdb: Scoped, ids: string[]) => sdb.selectShared(systemFonts, inArray(systemFonts.fontId, ids));

/**
 * Sinh id mới không trùng ở `user_fonts` (của mọi người dùng) lẫn `system_fonts` — truy vấn không scoped nên truyền
 * kết nối thô (`inJobTx`). Xác suất trùng ~2^-32; thử lại tối đa 3 lần.
 */
export async function allocateCustomFontId(t: DbLike, generate: () => string = newCustomFontId): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = generate();
    const [own, system] = await Promise.all([
      t.select({ id: userFonts.id }).from(userFonts).where(eq(userFonts.fontId, id)).limit(1),
      t.select({ id: systemFonts.id }).from(systemFonts).where(eq(systemFonts.fontId, id)).limit(1),
    ]);
    if (own.length === 0 && system.length === 0) return id;
  }
  throw new Error("không sinh được font id không trùng");
}

/** Trong những `ids` (không trùng), id nào không phải font gói sẵn, font hệ thống cũng không phải font của người dùng. */
export async function unknownFonts(sdb: Scoped, ids: string[]): Promise<string[]> {
  const custom = [...new Set(ids)].filter((id) => !BUNDLED_FONT_IDS.includes(id));
  if (custom.length === 0) return [];
  const [own, system] = await Promise.all([
    sdb.select(userFonts, inArray(userFonts.fontId, custom)),
    systemFontRows(sdb, custom),
  ]);
  const have = new Set([...own, ...system].map((f) => f.fontId));
  return custom.filter((id) => !have.has(id));
}

export async function isKnownFont(sdb: Scoped, id: string): Promise<boolean> {
  return (await unknownFonts(sdb, [id])).length === 0;
}

export type CustomFontRef = { id: string; file_key: string; sha256: string };

/**
 * Font tuỳ chỉnh (file_key + sha256) cho job: font hệ thống + font của người dùng, bỏ qua id gói sẵn / đã xoá / lạ
 * (worker và editor fallback font mặc định cho id không thấy).
 */
export async function resolveCustomFonts(sdb: Scoped, ids: Iterable<string | undefined>): Promise<CustomFontRef[]> {
  const wanted = [...new Set([...ids].filter((id): id is string => !!id && isCustomFontId(id)))];
  if (wanted.length === 0) return [];
  const [own, system] = await Promise.all([
    sdb.select(userFonts, inArray(userFonts.fontId, wanted)),
    systemFontRows(sdb, wanted),
  ]);
  return [...own, ...system]
    .map((r) => ({ id: r.fontId, file_key: r.fileKey, sha256: r.sha256 }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
