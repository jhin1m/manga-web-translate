import { describe, expect, it } from "vitest";
import { anchorShift, clampZoom, fitScale, MAX_ZOOM, MIN_ZOOM, stepZoom, wheelZoom } from "./source-zoom.ts";

describe("fitScale", () => {
  it("never enlarges past the natural size", () => {
    expect(fitScale(800, 400)).toBe(0.5);
    expect(fitScale(300, 900)).toBe(1);
  });
  it("falls back to 1 when the frame or image is not measured", () => {
    expect(fitScale(0, 400)).toBe(1);
    expect(fitScale(800, 0)).toBe(1);
  });
});

describe("zoom steps", () => {
  it("wheel up zooms in, down zooms out, both clamped", () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1);
    expect(wheelZoom(1, 100)).toBeLessThan(1);
    expect(wheelZoom(MAX_ZOOM, -10_000)).toBe(MAX_ZOOM);
    expect(wheelZoom(MIN_ZOOM, 10_000)).toBe(MIN_ZOOM);
  });
  it("+ / - move by a fixed ratio and stop at the limits", () => {
    expect(stepZoom(1, 1)).toBeCloseTo(1.25);
    expect(stepZoom(1, -1)).toBeCloseTo(0.8);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
  });
});

describe("anchorShift", () => {
  it("is zero when the anchored point is still under the cursor", () => {
    // image left edge at 100, anchor at 200 natural px, scale 0.5 -> 200 on screen; cursor at 200.
    expect(anchorShift(100, 200, 0.5, 200)).toBe(0);
    expect(anchorShift(0, 200, 0.5, 100)).toBe(0);
  });
  it("scrolls by how far the anchor drifted", () => {
    expect(anchorShift(0, 200, 1, 150)).toBe(50);
  });
});
