import { afterEach, describe, expect, it, vi } from "vitest";
import { loadFonts } from "../fonts.ts";

const entry = { file: "x.ttf", viComplete: true, unitsPerEm: 1000, ascent: 900, descent: 200 };
const manifest = { version: 1, defaults: ["Bangers-Regular"], fonts: { "Bangers-Regular": entry } };

/** DOM tối thiểu cho loadFonts: canvas đo chữ, FontFace nạp luôn thành công, fetch manifest. */
function stubBrowser() {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(manifest)));
  vi.stubGlobal(
    "FontFace",
    class {
      async load() {
        return this;
      }
    },
  );
  vi.stubGlobal("document", {
    createElement: () => ({ getContext: () => ({ font: "", measureText: () => ({ width: 1 }) }) }),
    fonts: { add: () => {}, ready: Promise.resolve() },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("loadFonts custom fonts", () => {
  it("FontKit.custom keeps the system flag so the editor can group system and own fonts", async () => {
    stubBrowser();
    const font = (id: string, name: string, system: boolean) => ({
      id,
      name,
      system,
      units_per_em: 1000,
      ascent: 900,
      descent: 200,
      url: `https://files/${id}`,
    });
    const kit = await loadFonts(async () => [
      font("custom-aaaaaaaa", "Sys", true),
      font("custom-bbbbbbbb", "Own", false),
    ]);
    expect(kit.custom).toEqual([
      { id: "custom-aaaaaaaa", name: "Sys", system: true },
      { id: "custom-bbbbbbbb", name: "Own", system: false },
    ]);
    expect(kit.knows("custom-aaaaaaaa")).toBe(true);
  });
});
