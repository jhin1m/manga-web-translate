import { describe, expect, it } from "vitest";
import { fontLabel, type UserFont } from "../../fonts/api.ts";
import { canvasFont, dialogueFont, type FontManifest } from "../fonts.ts";

const entry = { file: "x.ttf", viComplete: true, unitsPerEm: 1000, ascent: 900, descent: 200 };
const manifest: FontManifest = {
  version: 1,
  defaults: ["Bangers-Regular", "BeVietnamPro-Regular"],
  fonts: { "Bangers-Regular": entry, "BeVietnamPro-Regular": entry },
};

describe("dialogueFont", () => {
  it("uses the series dialogue font when the manifest has it", () => {
    expect(dialogueFont(manifest, "BeVietnamPro-Regular")).toBe("BeVietnamPro-Regular");
  });

  it("falls back to the manifest default when unset or no longer shipped", () => {
    expect(dialogueFont(manifest, undefined)).toBe("Bangers-Regular");
    expect(dialogueFont(manifest, "Removed-Font")).toBe("Bangers-Regular");
  });
});

describe("custom fonts", () => {
  it("dialogueFont accepts a custom font through isKnown, and falls back once it is gone", () => {
    const known = new Set(["custom-0a1b2c3d"]);
    expect(dialogueFont(manifest, "custom-0a1b2c3d", (id) => known.has(id))).toBe("custom-0a1b2c3d");
    expect(dialogueFont(manifest, "custom-0a1b2c3d", () => false)).toBe("Bangers-Regular");
  });

  it("canvas font string lists the default family second so unknown ids still draw in it", () => {
    expect(canvasFont("custom-ffffffff", 24)).toBe('24px "custom-ffffffff", "Bangers-Regular"');
  });

  it("fontLabel shows the file's name for custom fonts and a short name for bundled ones", () => {
    const custom = [{ id: "custom-0a1b2c3d", name: "Anime Ace" }] as UserFont[];
    expect(fontLabel("custom-0a1b2c3d", custom)).toBe("Anime Ace");
    expect(fontLabel("PatrickHand-Regular", custom)).toBe("PatrickHand");
    expect(fontLabel(undefined, custom)).toBe("Mặc định");
  });
});
