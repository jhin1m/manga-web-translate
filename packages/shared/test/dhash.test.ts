import { describe, expect, it } from "vitest";
import { dhashFromGray, hamming, isPlainHash, sameImage } from "../src/dhash.ts";

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
