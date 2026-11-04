/** Font gói sẵn + font thoại mặc định phải khớp worker/fonts/manifest.json (worker vẽ, editor đo theo đó). */
import { readFileSync } from "node:fs";
import { scoped, systemFonts, userFonts } from "@mtl/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIALOGUE_FONT } from "../src/jobs/enqueue.ts";
import {
  allocateCustomFontId,
  BUNDLED_FONT_IDS,
  isKnownFont,
  resolveCustomFonts,
  unknownFonts,
} from "../src/lib/fonts.ts";
import { db, seedUser } from "./helpers.ts";

const manifest = JSON.parse(readFileSync(new URL("../../../worker/fonts/manifest.json", import.meta.url), "utf8")) as {
  defaults: string[];
  fonts: Record<string, { viComplete: boolean }>;
};

describe("fonts", () => {
  it("bundled font choices are exactly the manifest fonts, all covering Vietnamese", () => {
    expect([...BUNDLED_FONT_IDS]).toEqual(Object.keys(manifest.fonts).sort());
    for (const id of BUNDLED_FONT_IDS) expect(manifest.fonts[id]?.viComplete).toBe(true);
  });

  it("default dialogue font is the manifest's first default", () => {
    expect(DEFAULT_DIALOGUE_FONT).toBe(manifest.defaults[0]);
  });

  it("isKnownFont accepts bundled ids and rejects unknown / foreign custom ids", async () => {
    const A = await seedUser("fontknown");
    const sdb = scoped(db, A.userId);
    expect(await isKnownFont(sdb, "Bangers-Regular")).toBe(true);
    expect(await isKnownFont(sdb, "custom-deadbeef")).toBe(false);
    expect(await unknownFonts(sdb, ["Anton-Regular", "nope", "nope"])).toEqual(["nope"]);
    expect(await resolveCustomFonts(sdb, ["Anton-Regular", undefined, "custom-deadbeef"])).toEqual([]);
  });

  describe("system fonts", () => {
    const SYS = "custom-5a5a5a5a";
    const row = (fontId: string, sha: string) => ({
      fontId,
      name: fontId,
      fileKey: `system/fonts/${fontId}`,
      sha256: sha.repeat(64),
      bytes: 10,
      unitsPerEm: 1000,
      ascent: 900,
      descent: 200,
      metricsSource: "hhea",
      viComplete: true,
      missing: [] as string[],
    });
    afterEach(async () => {
      await db.delete(systemFonts).where(eq(systemFonts.fontId, SYS));
    });

    it("isKnownFont accepts an existing system font for any user and rejects it once deleted", async () => {
      const [A, B] = await Promise.all([seedUser("fontsys-a"), seedUser("fontsys-b")]);
      expect(await isKnownFont(scoped(db, A.userId), SYS)).toBe(false);
      await db.insert(systemFonts).values(row(SYS, "5"));
      for (const u of [A, B]) expect(await isKnownFont(scoped(db, u.userId), SYS)).toBe(true);
      await db.delete(systemFonts).where(eq(systemFonts.fontId, SYS));
      expect(await isKnownFont(scoped(db, A.userId), SYS)).toBe(false);
    });

    it("resolveCustomFonts merges system and own fonts, never another user's", async () => {
      const [A, B] = await Promise.all([seedUser("fontres-a"), seedUser("fontres-b")]);
      const own = { ...row("custom-0a0a0a0a", "a"), fileKey: `u/${A.userId}/fonts/own` };
      const foreign = { ...row("custom-0b0b0b0b", "b"), fileKey: `u/${B.userId}/fonts/foreign` };
      await scoped(db, A.userId).insert(userFonts, own);
      await scoped(db, B.userId).insert(userFonts, foreign);
      await db.insert(systemFonts).values(row(SYS, "5"));
      const got = await resolveCustomFonts(scoped(db, A.userId), [SYS, own.fontId, foreign.fontId, "Anton-Regular"]);
      expect(got.map((f) => [f.id, f.file_key])).toEqual([
        [own.fontId, own.fileKey],
        [SYS, `system/fonts/${SYS}`],
      ]);
    });

    it("allocateCustomFontId retries past an id already used in either table", async () => {
      const taken = "custom-11111111";
      const A = await seedUser("fontalloc");
      await scoped(db, A.userId).insert(userFonts, { ...row(taken, "1"), fileKey: `u/${A.userId}/fonts/x` });
      await db.insert(systemFonts).values(row(SYS, "5"));
      const ids = [taken, SYS, "custom-22222222"];
      expect(await allocateCustomFontId(db, () => ids.shift() ?? "")).toBe("custom-22222222");
      // Ba lần đầu đều trùng → ném lỗi thay vì trả id trùng.
      const dup = [taken, SYS, taken];
      await expect(allocateCustomFontId(db, () => dup.shift() ?? "")).rejects.toThrow();
    });
  });
});
