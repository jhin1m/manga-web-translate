import { describe, expect, it } from "vitest";
import { dialogueFont, type FontManifest } from "../fonts.ts";

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
