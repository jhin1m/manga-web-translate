/** Font gói sẵn + font thoại mặc định phải khớp worker/fonts/manifest.json (worker vẽ, editor đo theo đó). */
import { readFileSync } from "node:fs";
import { scoped } from "@mtl/db";
import { describe, expect, it } from "vitest";
import { DEFAULT_DIALOGUE_FONT } from "../src/jobs/enqueue.ts";
import { BUNDLED_FONT_IDS, isKnownFont, resolveCustomFonts, unknownFonts } from "../src/lib/fonts.ts";
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
});
