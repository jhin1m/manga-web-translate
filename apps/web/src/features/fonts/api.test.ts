import { describe, expect, it } from "vitest";
import { fontUploadError, MAX_USER_FONTS, ownFonts, type UserFont } from "./api.ts";

const ttf = (name = "a.ttf", size = 1000) => new File([new Uint8Array(size)], name);
const font = (id: string, system: boolean) => ({ id, system }) as UserFont;

describe("fontUploadError", () => {
  it("accepts a TTF/OTF under the limits", () => {
    expect(fontUploadError(ttf(), 0)).toBeNull();
    expect(fontUploadError(ttf("B.OTF"), MAX_USER_FONTS - 1)).toBeNull();
  });

  it("rejects the 21st own font, a WOFF and an oversized file", () => {
    expect(fontUploadError(ttf(), MAX_USER_FONTS)).toMatch(/tối đa 20 font/);
    expect(fontUploadError(ttf("a.woff"), 0)).toMatch(/\.ttf hoặc \.otf/);
    expect(fontUploadError(ttf("a.ttf", 10 * 1024 * 1024 + 1), 0)).toMatch(/10MB/);
  });

  it("does not count system fonts: 20 system + 0 own fonts is no error", () => {
    const list = Array.from({ length: MAX_USER_FONTS }, (_, i) => font(`custom-${i}`, true));
    expect(ownFonts(list)).toHaveLength(0);
    expect(fontUploadError(ttf(), ownFonts(list).length)).toBeNull();
    expect(ownFonts([...list, font("custom-own", false)]).map((f) => f.id)).toEqual(["custom-own"]);
  });
});
