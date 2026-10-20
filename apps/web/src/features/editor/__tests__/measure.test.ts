import { describe, expect, it } from "vitest";
import {
  blockHeight,
  fitText,
  hardWrap,
  layoutBox,
  linePlacements,
  MAX_SIZE,
  MIN_SIZE,
  nfc,
  wrapWords,
} from "../measure.ts";
import { box, METRICS, measure } from "./fixtures.ts";

describe("measure (layout contract)", () => {
  it("wraps greedily by word like typeset.py; a word wider than max → null", () => {
    // 20px → 10px/char. "Anh đang" = 8 chars = 80px.
    expect(wrapWords("Anh đang làm gì vậy", "F", 20, 80, measure)).toEqual(["Anh đang", "làm gì", "vậy"]);
    expect(wrapWords("Khôngvừađâu", "F", 20, 80, measure)).toBeNull();
  });

  it("keeps user line breaks as paragraphs", () => {
    expect(wrapWords("Một\nhai ba", "F", 20, 200, measure)).toEqual(["Một", "hai ba"]);
  });

  it("hard-wraps by character", () => {
    expect(hardWrap("abcdefghij", "F", 20, 40, measure)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("normalizes to NFC before measuring", () => {
    const nfd = "ệ".normalize("NFD");
    expect(nfd.length).toBe(3);
    expect(wrapWords(nfd, "F", 20, 100, measure)).toEqual(["ệ"]);
    expect(nfc(nfd)).toBe("ệ");
  });

  it("block height = asc+desc + (n−1)·(asc+desc)·line_height", () => {
    expect(blockHeight(METRICS, 20, 1, 1.15)).toBeCloseTo(20);
    expect(blockHeight(METRICS, 20, 3, 1.15)).toBeCloseTo(20 + 2 * 20 * 1.15);
  });

  it("fits the largest integer size; falls back to MIN with hard wrap", () => {
    const r = fitText("Xin chào", "F", 200, 100, 4, 1.15, METRICS, measure);
    expect(Number.isInteger(r.size)).toBe(true);
    expect(r.size).toBeGreaterThanOrEqual(MIN_SIZE);
    expect(r.size).toBeLessThanOrEqual(MAX_SIZE);
    // Cỡ kế tiếp không vừa.
    const next = r.size + 1;
    const lines = wrapWords("Xin chào", "F", next, 192, measure);
    expect(lines === null || blockHeight(METRICS, next, lines.length, 1.15) > 92 || next > MAX_SIZE).toBe(true);
    const tiny = fitText("Dàiquáđi", "F", 20, 20, 4, 1.15, METRICS, measure);
    expect(tiny.size).toBe(MIN_SIZE);
    expect(tiny.lines.join("")).toBe("Dàiquáđi");
  });

  it("layoutBox keeps size without auto_fit and fits with it", () => {
    const b = { ...box("t"), text: "Anh đang làm gì vậy", w: 88, pad: 4 };
    expect(layoutBox(b, METRICS, measure)).toEqual({ lines: ["Anh đang", "làm gì", "vậy"], font_size: 20 });
    const fit = fitText(b.text, "F", 88, b.h, 4, b.line_height, METRICS, measure);
    expect(layoutBox({ ...b, auto_fit: true }, METRICS, measure)).toEqual({ lines: fit.lines, font_size: fit.size });
    expect(layoutBox({ ...b, text: "  " }, METRICS, measure).lines).toEqual([]);
  });

  it("places baselines from font metrics and x by alignment (rules 3–4)", () => {
    const b = { ...box("t"), lines: ["ab", "abcd"], w: 100, pad: 4, font_size: 20, line_height: 1.5 };
    const center = linePlacements(b, METRICS, measure);
    expect(center[0]).toMatchObject({ x: 4 + (92 - 20) / 2, baseline: 4 + 16, advance: 20 });
    expect(center[1]?.baseline).toBeCloseTo(4 + 16 + 20 * 1.5);
    expect(linePlacements({ ...b, align: "left" }, METRICS, measure)[1]?.x).toBe(4);
    expect(linePlacements({ ...b, align: "right" }, METRICS, measure)[1]?.x).toBe(4 + 92 - 40);
  });
});
