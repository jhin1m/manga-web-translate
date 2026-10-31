import { describe, expect, it } from "vitest";
import {
  blockBarPos,
  clampView,
  contentBox,
  FIT_EDGE,
  FIT_HEIGHT_MIN,
  fitScale,
  fitsAxis,
  pageStartView,
  SPLIT_GAP,
} from "../page-layout.ts";

describe("block toolbar position", () => {
  const frame = { w: 800, h: 600 };
  const bar = { w: 150, h: 38 };
  it("sits above the block, 8px apart", () => {
    expect(blockBarPos({ x: 100, y: 200, w: 120, h: 60 }, { scale: 1, x: 0, y: 0 }, frame, bar)).toEqual({
      left: 100,
      top: 200 - 8 - 38,
      below: false,
    });
  });
  it("goes below a block near the top edge of the view", () => {
    expect(blockBarPos({ x: 100, y: 20, w: 120, h: 60 }, { scale: 1, x: 0, y: 0 }, frame, bar)).toEqual({
      left: 100,
      top: 20 + 60 + 8,
      below: true,
    });
  });
  it("keeps a larger gap above (rotation handle) but the normal gap below", () => {
    expect(blockBarPos({ x: 100, y: 200, w: 120, h: 60 }, { scale: 1, x: 0, y: 0 }, frame, bar, 8, 32).top).toBe(
      200 - 32 - 38,
    );
    expect(blockBarPos({ x: 100, y: 50, w: 120, h: 60 }, { scale: 1, x: 0, y: 0 }, frame, bar, 8, 32)).toMatchObject({
      top: 50 + 60 + 8,
      below: true,
    });
  });
  it("stays inside the frame vertically when the block is taller than the view", () => {
    expect(blockBarPos({ x: 100, y: -50, w: 120, h: 900 }, { scale: 1, x: 0, y: 0 }, frame, bar)).toMatchObject({
      top: 600 - 38 - 8,
      below: true,
    });
  });
  it("clamps inside the frame horizontally", () => {
    expect(blockBarPos({ x: -50, y: 200, w: 60, h: 60 }, { scale: 1, x: 0, y: 0 }, frame, bar).left).toBe(8);
    expect(blockBarPos({ x: 760, y: 200, w: 60, h: 60 }, { scale: 1, x: 0, y: 0 }, frame, bar).left).toBe(
      800 - 150 - 8,
    );
  });
  it("follows zoom and pan", () => {
    expect(blockBarPos({ x: 100, y: 200, w: 120, h: 60 }, { scale: 2, x: 10, y: -100 }, frame, bar)).toEqual({
      left: 210,
      top: 300 - 46,
      below: false,
    });
    expect(blockBarPos({ x: 100, y: 200, w: 120, h: 60 }, { scale: 0.5, x: 0, y: 0 }, frame, bar)).toEqual({
      left: 50,
      top: 100 - 46,
      below: false,
    });
  });
});

describe("page layout", () => {
  it("opens a page centered and fitted to that page, not to the widest page of the chapter", () => {
    // Chương có 1 trang credit rộng 4036px: trang 800px vẫn hiện 100%, nằm giữa khung.
    const v = pageStartView({ w: 800, h: 4500 }, false, { w: 1532, h: 700 });
    expect(v.scale).toBe(1);
    expect(v.x).toBe((1532 - 800) / 2);
    expect(v.y).toBe(FIT_EDGE);
  });

  it("keeps the user's zoom when asked, still centered and at the top of the page", () => {
    const v = pageStartView({ w: 800, h: 4500 }, false, { w: 1532, h: 700 }, 0.5);
    expect(v.scale).toBe(0.5);
    expect(v.x).toBe((1532 - 400) / 2);
    expect(v.y).toBe(FIT_EDGE);
  });

  it("split view opens with both columns centered", () => {
    const page = { w: 800, h: 4500 };
    const c = contentBox(page, true);
    const v = pageStartView(page, true, { w: 2000, h: 700 });
    expect(v.x + c.x * v.scale).toBeCloseTo((2000 - c.w * v.scale) / 2);
  });

  it("clamps the view to the page (narrow page centered)", () => {
    const v = clampView({ scale: 1, x: 999, y: -99_999 }, { w: 800, h: 12_000 }, { w: 1200, h: 800 });
    expect(v.x).toBe(200);
    expect(v.y).toBe(800 - 12_000 - 40);
  });

  it("a page fitted with FIT_EDGE margins is pinned: any wheel offset clamps back to the fit view", () => {
    const box = { w: 1170, h: 900 };
    const page = { w: 954, h: 1500 };
    const scale = fitScale(page, page, box);
    const fit = pageStartView(page, false, box);
    expect(fitsAxis(page.h * scale, box.h)).toBe(true);
    expect(fit.y).toBeCloseTo(FIT_EDGE);
    for (const y of [-500, -8, 0, 40, 500]) expect(clampView({ ...fit, y }, page, box).y).toBeCloseTo(fit.y);
    // Không vừa với lề FIT_EDGE (cao hơn 1px) thì vẫn cuộn được.
    expect(fitsAxis(box.h - 2 * FIT_EDGE + 1, box.h)).toBe(false);
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

  describe("fitScale", () => {
    const box = { w: 1170, h: 900 };
    const portrait = { w: 954, h: 1500 };

    it("fits a whole portrait page in the view height", () => {
      const s = fitScale(portrait, portrait, box);
      expect(s).toBeCloseTo((box.h - 2 * FIT_EDGE) / portrait.h);
      expect(portrait.h * s).toBeLessThanOrEqual(box.h - 2 * FIT_EDGE + 1e-9);
    });

    it("fits a landscape spread by width", () => {
      const spread = { w: 3000, h: 1500 };
      expect(fitScale(spread, spread, { w: 1170, h: 900 })).toBeCloseTo((1170 - 2 * FIT_EDGE) / spread.w);
    });

    it("fits a 1500px page whole at the readable minimum in a ~800px view", () => {
      const s = fitScale(portrait, portrait, { w: 1600, h: 800 });
      expect(s).toBeGreaterThanOrEqual(FIT_HEIGHT_MIN);
      expect(portrait.h * s + 2 * FIT_EDGE).toBeLessThanOrEqual(800 + 1e-9);
    });

    it("stops shrinking for height at the readable minimum when the view is short", () => {
      expect(fitScale(portrait, portrait, { w: 1170, h: 400 })).toBe(FIT_HEIGHT_MIN);
      // Bề ngang vẫn thắng: khung hẹp thu dưới mức đọc được theo chiều cao.
      expect(fitScale(portrait, portrait, { w: 300, h: 400 })).toBeCloseTo((300 - 2 * FIT_EDGE) / portrait.w);
    });

    it("never zooms past 100%", () => {
      const small = { w: 400, h: 300 };
      expect(fitScale(small, small, { w: 2000, h: 1500 })).toBe(1);
    });

    it("fits a tall webtoon slice by width only", () => {
      const slice = { w: 1500, h: 4500 };
      expect(fitScale(slice, slice, box)).toBeCloseTo((box.w - 2 * FIT_EDGE) / slice.w);
    });

    it("split view fits both columns side by side and the page height", () => {
      const both = contentBox(portrait, true);
      const s = fitScale(both, portrait, { w: 1170, h: 1200 });
      expect(both.w * s).toBeLessThanOrEqual(1170 - 2 * FIT_EDGE + 1e-9);
      expect(s).toBeCloseTo((1170 - 2 * FIT_EDGE) / both.w);
      expect(fitScale(both, portrait, { w: 3000, h: 1000 })).toBeCloseTo((1000 - 2 * FIT_EDGE) / portrait.h);
    });

    it("falls back to width fit without a page and respects the minimum", () => {
      expect(fitScale(portrait, undefined, box)).toBe(1);
      expect(fitScale({ w: 100_000, h: 10 }, undefined, box)).toBe(0.1);
    });
  });
});
