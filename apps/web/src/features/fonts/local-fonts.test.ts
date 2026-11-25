import { describe, expect, it } from "vitest";
import { filterFonts, type LocalFont, localFontFile, sfntKind, uniqueFonts } from "./local-fonts.ts";

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const font = (fullName: string, over: Partial<LocalFont> = {}, data = bytes("\x00\x01\x00\x00rest")): LocalFont => ({
  family: fullName.split(" ")[0] ?? fullName,
  fullName,
  postscriptName: fullName.replace(/\s/g, "-"),
  style: "Regular",
  blob: async () => new Blob([data]),
  ...over,
});

describe("local fonts", () => {
  it("detects the sfnt flavour from the first 4 bytes", () => {
    expect(sfntKind(bytes("\x00\x01\x00\x00"))).toBe("ttf");
    expect(sfntKind(bytes("true"))).toBe("ttf");
    expect(sfntKind(bytes("OTTO"))).toBe("otf");
    expect(sfntKind(bytes("ttcf"))).toBe("ttc");
    expect(sfntKind(bytes("wOF2"))).toBeNull();
  });

  it("drops duplicates by postscript name and sorts by family then style", () => {
    const list = uniqueFonts([
      font("Roboto Bold", { family: "Roboto", style: "Bold" }),
      font("Arial", { family: "Arial" }),
      font("Arial", { family: "Arial" }),
      font("Roboto Regular", { family: "Roboto", style: "Regular" }),
    ]);
    expect(list.map((f) => f.fullName)).toEqual(["Arial", "Roboto Bold", "Roboto Regular"]);
  });

  it("filters by name ignoring case and Vietnamese marks", () => {
    const list = [font("Bé Vui"), font("Comic Neue")];
    expect(filterFonts(list, "be vui").map((f) => f.fullName)).toEqual(["Bé Vui"]);
    expect(filterFonts(list, "  ")).toHaveLength(2);
  });

  it("turns a TTF / OTF into an upload file and rejects collections and other formats", async () => {
    const ttf = await localFontFile(font("CC Wild Words"));
    expect(ttf.name).toBe("CC-Wild-Words.ttf");
    expect((await localFontFile(font("X", {}, bytes("OTTOxx")))).name).toBe("X.otf");
    await expect(localFontFile(font("Y", {}, bytes("ttcfxx")))).rejects.toThrow(/TTC/);
    await expect(localFontFile(font("Z", {}, bytes("wOF2xx")))).rejects.toThrow(/TTF \/ OTF/);
  });
});
