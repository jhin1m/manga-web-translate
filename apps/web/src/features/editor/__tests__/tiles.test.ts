import { describe, expect, it } from "vitest";
import { strokesBounds } from "../canvas/MaskLayer.tsx";
import { TILE, visibleTiles } from "../canvas/TileLayer.tsx";
import { clampView } from "../page-layout.ts";

describe("tile culling (strip 800×12000)", () => {
  const page = { w: 800, h: 12_000 };

  it("mounts only tiles in the viewport ± 1, each ≤ 2048px", () => {
    const tiles = visibleTiles(page, { x: 0, y: 5000, w: 800, h: 900 });
    expect(tiles.map((t) => t.key)).toEqual(["1:0", "2:0", "3:0"]);
    for (const t of tiles) expect(Math.max(t.w, t.h)).toBeLessThanOrEqual(TILE);
    const last = visibleTiles(page, { x: 0, y: 11_500, w: 800, h: 900 }).at(-1);
    expect(last).toMatchObject({ key: "5:0", y: 10_240, h: 1_760 });
  });

  it("covers 20000px pages too", () => {
    const tiles = visibleTiles({ w: 800, h: 20_000 }, { x: 0, y: 19_000, w: 800, h: 1000 });
    expect(tiles.at(-1)).toMatchObject({ key: "9:0", h: 20_000 - 9 * TILE });
  });
});

describe("view clamp", () => {
  it("centers a narrow page and keeps the strip in reach", () => {
    const v = clampView({ scale: 1, x: 999, y: -99_999 }, { w: 800, h: 12_000 }, { w: 1200, h: 800 });
    expect(v.x).toBe(200);
    expect(v.y).toBe(800 - 12_000 - 40);
  });
});

describe("mask bounds", () => {
  it("bounds paint strokes (+ half brush), clipped to the page; erase-only → null", () => {
    const b = strokesBounds([{ mode: "paint", size: 20, points: [5, 100, 50, 120] }], { w: 800, h: 1000 });
    expect(b).toEqual({ x: 0, y: 89, w: 61, h: 42 });
    expect(strokesBounds([{ mode: "erase", size: 20, points: [5, 5] }], { w: 800, h: 1000 })).toBeNull();
  });
});
