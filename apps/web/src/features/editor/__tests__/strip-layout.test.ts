import { describe, expect, it } from "vitest";
import {
  clampView,
  contentBox,
  MAX_MOUNTED,
  pageAt,
  pageOffsets,
  SPLIT_GAP,
  stripToPage,
  visiblePages,
} from "../strip-layout.ts";

describe("strip layout", () => {
  const heights = [1000, 2000, 500];
  const offsets = pageOffsets(heights);

  it("stacks pages by height", () => {
    expect(offsets).toEqual([0, 1000, 3000]);
  });

  it("finds the page under a strip y", () => {
    expect(pageAt(0, offsets)).toBe(0);
    expect(pageAt(999, offsets)).toBe(0);
    expect(pageAt(1000, offsets)).toBe(1);
    expect(pageAt(2999, offsets)).toBe(1);
    expect(pageAt(3200, offsets)).toBe(2);
    expect(pageAt(99_999, offsets)).toBe(2);
    expect(pageAt(-5, offsets)).toBe(0);
    expect(pageAt(10, [])).toBe(-1);
  });

  it("mounts pages in the viewport (± overscan)", () => {
    expect(visiblePages(offsets, heights, { y: 900, h: 300 })).toEqual([0, 1]);
    expect(visiblePages(offsets, heights, { y: 900, h: 300 }, 0)).toEqual([0, 1]);
    expect(visiblePages(offsets, heights, { y: 1500, h: 300 }, 0)).toEqual([1]);
  });

  it("never mounts more than 4 pages, keeping those nearest the center", () => {
    const hs = Array.from({ length: 20 }, () => 200);
    const os = pageOffsets(hs);
    for (let y = 0; y < 4000; y += 137) {
      const v = visiblePages(os, hs, { y, h: 900 });
      expect(v.length).toBeLessThanOrEqual(MAX_MOUNTED);
      expect(v).toEqual([...v].sort((a, b) => a - b));
    }
    // Vùng nhìn y=1000..1900 chạm page 5–9, tâm 1450 thuộc page 7 → bỏ page 9 (xa tâm nhất).
    expect(visiblePages(os, hs, { y: 1000, h: 900 }, 0)).toEqual([5, 6, 7, 8]);
  });

  it("converts strip to page coordinates", () => {
    expect(stripToPage({ x: 5, y: 1200 }, 1000)).toEqual({ x: 5, y: 200 });
  });

  it("clamps the view to the strip (narrow strip centered)", () => {
    const v = clampView({ scale: 1, x: 999, y: -99_999 }, { w: 800, h: 12_000 }, { w: 1200, h: 800 });
    expect(v.x).toBe(200);
    expect(v.y).toBe(800 - 12_000 - 40);
  });

  it("split view: original column sits left of the strip, clamping keeps both columns in view", () => {
    const c = contentBox({ w: 800, h: 12_000 }, true);
    expect(c).toEqual({ x: -(800 + SPLIT_GAP), w: 1600 + SPLIT_GAP, h: 12_000 });
    // Rộng hơn khung → mép trái nội dung (cột Gốc) không vượt quá lề.
    const v = clampView({ scale: 1, x: 5000, y: 0 }, c, { w: 1200, h: 800 }, c.x);
    expect(v.x + c.x).toBe(40);
    // Hẹp hơn khung → căn giữa cả 2 cột.
    const z = clampView({ scale: 0.5, x: 0, y: 0 }, c, { w: 1200, h: 800 }, c.x);
    expect(z.x + c.x * 0.5).toBeCloseTo((1200 - c.w * 0.5) / 2);
  });
});
