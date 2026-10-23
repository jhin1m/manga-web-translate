/** Metrics TS (fontkit) phải khớp từng số với manifest do worker (fontTools) sinh ra — editor ↔ worker cùng layout. */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readFontInfo, sniffFont } from "../src/lib/font-metrics.ts";

const dir = new URL("../../../worker/fonts/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8")) as {
  fonts: Record<
    string,
    {
      file: string;
      unitsPerEm: number;
      ascent: number;
      descent: number;
      metricsSource: string;
      viComplete: boolean;
      missing: string[];
    }
  >;
};

describe("font metrics parity with the worker manifest", () => {
  it("covers every bundled font file", () => {
    const files = readdirSync(dir).filter((f) => /\.[ot]tf$/.test(f));
    expect(
      Object.values(manifest.fonts)
        .map((f) => f.file)
        .sort(),
    ).toEqual(files.sort());
  });

  for (const [id, want] of Object.entries(manifest.fonts)) {
    it(`${id}: unitsPerEm/ascent/descent/source/coverage match`, () => {
      const bytes = readFileSync(new URL(want.file, dir));
      expect(sniffFont(bytes.subarray(0, 4))).not.toBeNull();
      const got = readFontInfo(bytes);
      expect({
        unitsPerEm: got.unitsPerEm,
        ascent: got.ascent,
        descent: got.descent,
        metricsSource: got.metricsSource,
        viComplete: got.viComplete,
        missing: got.missing,
      }).toEqual({
        unitsPerEm: want.unitsPerEm,
        ascent: want.ascent,
        descent: want.descent,
        metricsSource: want.metricsSource,
        viComplete: want.viComplete,
        missing: want.missing,
      });
      expect(got.name.length).toBeGreaterThan(0);
    });
  }
});

describe("sniffFont / readFontInfo", () => {
  it("accepts ttf/otf, rejects woff/woff2/ttc/html", () => {
    expect(sniffFont(Buffer.from([0, 1, 0, 0, 9]))).toBe("ttf");
    expect(sniffFont(Buffer.from("OTTO..."))).toBe("otf");
    for (const t of ["wOFF", "wOF2", "ttcf", "<!do"]) expect(sniffFont(Buffer.from(t))).toBeNull();
    expect(sniffFont(Buffer.from([0, 1]))).toBeNull();
  });

  it("throws on a truncated font", () => {
    const bytes = readFileSync(new URL("Itim-Regular.ttf", dir)).subarray(0, 300);
    expect(() => readFontInfo(bytes)).toThrow();
  });
});
