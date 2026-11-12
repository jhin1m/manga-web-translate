import { describe, expect, it } from "vitest";
import {
  bandWindow,
  dhashFromGray,
  grayGridFromRgba,
  hamming,
  isPlainHash,
  sameBand,
  sameImage,
} from "../src/dhash.ts";

/** 9×8 điểm xám từ hàm f(x, y). */
const grid = (f: (x: number, y: number) => number) => Array.from({ length: 72 }, (_, i) => f(i % 9, Math.floor(i / 9)));

describe("dhash", () => {
  it("bit = left brighter than right, row by row, most significant first", () => {
    // Tối dần sang phải → mọi bit 1; sáng dần → mọi bit 0.
    expect(dhashFromGray(grid((x) => 255 - x * 20))).toBe("ffffffffffffffff");
    expect(dhashFromGray(grid((x) => x * 20))).toBe("0000000000000000");
    // Chỉ hàng đầu tối dần: 8 bit đầu là 1.
    expect(dhashFromGray(grid((x, y) => (y === 0 ? 255 - x : x)))).toBe("ff00000000000000");
    // Hàng sọc: điểm chẵn sáng → bit 1 ở vị trí chẵn của mỗi hàng (10101010).
    expect(dhashFromGray(grid((x) => (x % 2 === 0 ? 200 : 10)))).toBe("aaaaaaaaaaaaaaaa");
  });

  it("rejects a grid that is not 9×8", () => {
    expect(() => dhashFromGray(new Uint8ClampedArray(64))).toThrow(RangeError);
  });

  it("hamming counts differing bits", () => {
    expect(hamming("0000000000000000", "0000000000000000")).toBe(0);
    expect(hamming("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hamming("f000000000000001", "0000000000000000")).toBe(5);
    expect(() => hamming("xyz", "0000000000000000")).toThrow(RangeError);
  });

  it("same image = hash within 6 bits and aspect ratio within 5%", () => {
    const known = { dhash: "0000000000000000", width: 800, height: 1200 };
    expect(sameImage({ dhash: "0000000000000007", width: 400, height: 600 }, known)).toBe(true);
    expect(sameImage({ dhash: "000000000000003f", width: 800, height: 1200 }, known)).toBe(true);
    expect(sameImage({ dhash: "000000000000007f", width: 800, height: 1200 }, known)).toBe(false);
    // Cùng hash, khung lệch 20% → khác ảnh.
    expect(sameImage({ dhash: "0000000000000000", width: 800, height: 1000 }, known)).toBe(false);
    expect(sameImage({ dhash: "0000000000000000", width: 800, height: 1150 }, known)).toBe(true);
  });

  it("near-blank hashes (≤ 8 or ≥ 56 one-bits) are too plain to learn", () => {
    expect(isPlainHash("0000000000000000")).toBe(true);
    expect(isPlainHash("00000000000000ff")).toBe(true);
    expect(isPlainHash("00000000000001ff")).toBe(false);
    expect(isPlainHash("0f0f0f0f0f0f0f0f")).toBe(false);
    expect(isPlainHash("ffffffffffffff00")).toBe(true);
    expect(isPlainHash("fffffffffffffe00")).toBe(false);
  });
});

describe("bandWindow", () => {
  const band = { width: 720, height: 100 };

  it("takes the band height as-is for an image of the same width", () => {
    expect(bandWindow(720, 1000, band, "bottom")).toEqual({ sy: 900, sh: 100 });
    expect(bandWindow(720, 1000, band, "top")).toEqual({ sy: 0, sh: 100 });
  });

  it("scales the band with the image width (720 <-> 800)", () => {
    expect(bandWindow(800, 1000, band, "bottom")).toEqual({ sy: 889, sh: 111 });
    expect(bandWindow(360, 1000, band, "top")).toEqual({ sy: 0, sh: 50 });
  });

  it("is null when the band would leave too little of the image", () => {
    expect(bandWindow(720, 160, band, "bottom")).toBeNull();
    expect(bandWindow(720, 164, band, "bottom")).toEqual({ sy: 64, sh: 100 });
  });

  it("is null when the scaled band is too thin to hash", () => {
    expect(bandWindow(720, 1000, { width: 720, height: 7 }, "top")).toBeNull();
    expect(bandWindow(72, 1000, { width: 720, height: 70 }, "top")).toBeNull();
    expect(bandWindow(720, 1000, { width: 720, height: 8 }, "top")).toEqual({ sy: 0, sh: 8 });
  });

  it("is null for empty sizes", () => {
    expect(bandWindow(0, 1000, band, "top")).toBeNull();
    expect(bandWindow(720, 1000, { width: 0, height: 10 }, "top")).toBeNull();
  });
});

describe("sameBand", () => {
  it("matches within 6 bits, not beyond", () => {
    const band = { dhash: "0000000000000000" };
    expect(sameBand("000000000000003f", band)).toBe(true);
    expect(sameBand("000000000000007f", band)).toBe(false);
  });
});

describe("grayGridFromRgba", () => {
  const rgba = (w: number, h: number, f: (x: number, y: number) => [number, number, number]) => {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set([...f(x, y), 255], (y * w + x) * 4);
    return out;
  };

  it("averages whole pixels per cell with the luminance weights of the whole-image path", () => {
    // 9×8 ảnh: mỗi điểm là 1 ô.
    const g = grayGridFromRgba(
      rgba(9, 8, (x) => [x * 10, 0, 0]),
      9,
      8,
    );
    expect(g).toHaveLength(72);
    expect(g[3]).toBe(Math.round(0.299 * 30));
    const white = grayGridFromRgba(
      rgba(9, 8, () => [255, 255, 255]),
      9,
      8,
    );
    expect(white[40]).toBe(255);
  });

  it("splits fractional pixel ranges by area", () => {
    // Rộng 18 → mỗi ô 2 cột; cao 16 → mỗi ô 2 hàng. Cột chẵn tối, cột lẻ sáng → mỗi ô trung bình 2 cột.
    const g = grayGridFromRgba(
      rgba(18, 16, (x) => (x % 2 ? [200, 200, 200] : [0, 0, 0])),
      18,
      16,
    );
    for (const v of g) expect(v).toBeCloseTo(100, 6);
    // Rộng 10: ô 0 phủ [0, 1.111) → cột 0 trọn + 0.111 cột 1.
    const h = grayGridFromRgba(
      rgba(10, 8, (x) => (x === 0 ? [0, 0, 0] : [90, 90, 90])),
      10,
      8,
    );
    expect(h[0]).toBe(Math.round((90 * (10 / 9 - 1)) / (10 / 9)));
    expect(h[8]).toBeCloseTo(90, 6);
  });

  it("gives nearly the same grid for the same picture at two widths", () => {
    const pic = (w: number, h: number) =>
      rgba(w, h, (x, y) => {
        const v = Math.floor(((x / w) * 9) % 2) ? 220 : 30 + ((y / h) * 8 > 4 ? 40 : 0);
        return [v, v, v];
      });
    const a = grayGridFromRgba(pic(720, 100), 720, 100);
    const b = grayGridFromRgba(pic(800, 111), 800, 111);
    for (let i = 0; i < 72; i++) expect(Math.abs((a[i] as number) - (b[i] as number))).toBeLessThan(25);
    expect(dhashFromGray(a)).toBe(dhashFromGray(b));
  });

  it("rejects a buffer that does not fit the size", () => {
    expect(() => grayGridFromRgba(new Uint8ClampedArray(10), 9, 8)).toThrow(RangeError);
    expect(() => grayGridFromRgba(new Uint8ClampedArray(0), 0, 8)).toThrow(RangeError);
  });
});
