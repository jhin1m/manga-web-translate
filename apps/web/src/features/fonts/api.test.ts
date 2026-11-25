import { USER_FONT_LIMIT } from "@mtl/shared";
import { describe, expect, it } from "vitest";
import { fontUploadError, ownFonts, type UserFont } from "./api.ts";

const MAX_USER_FONTS = USER_FONT_LIMIT.hosted;

const ttf = (name = "a.ttf", size = 1000) => new File([new Uint8Array(size)], name);
const font = (id: string, system: boolean) => ({ id, system }) as UserFont;

describe("fontUploadError", () => {
  it("accepts a TTF/OTF under the limits", () => {
    expect(fontUploadError(ttf(), 0, MAX_USER_FONTS)).toBeNull();
    expect(fontUploadError(ttf("B.OTF"), MAX_USER_FONTS - 1, MAX_USER_FONTS)).toBeNull();
  });

  it("rejects the 21st own font, a WOFF and an oversized file", () => {
    expect(fontUploadError(ttf(), MAX_USER_FONTS, MAX_USER_FONTS)).toMatch(/tối đa 20 font/);
    expect(fontUploadError(ttf(), MAX_USER_FONTS, USER_FONT_LIMIT.local)).toBeNull();
    expect(fontUploadError(ttf(), USER_FONT_LIMIT.local, USER_FONT_LIMIT.local)).toMatch(/tối đa 200 font/);
    expect(fontUploadError(ttf("a.woff"), 0, MAX_USER_FONTS)).toMatch(/\.ttf hoặc \.otf/);
    expect(fontUploadError(ttf("a.ttf", 10 * 1024 * 1024 + 1), 0, MAX_USER_FONTS)).toMatch(/10MB/);
  });

  it("does not count system fonts: 20 system + 0 own fonts is no error", () => {
    const list = Array.from({ length: MAX_USER_FONTS }, (_, i) => font(`custom-${i}`, true));
    expect(ownFonts(list)).toHaveLength(0);
    expect(fontUploadError(ttf(), ownFonts(list).length, MAX_USER_FONTS)).toBeNull();
    expect(ownFonts([...list, font("custom-own", false)]).map((f) => f.id)).toEqual(["custom-own"]);
  });
});
