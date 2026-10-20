import { describe, expect, it } from "vitest";
import {
  blockHeight,
  boxOverflow,
  boxOverflows,
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

  it("flags a box whose lines no longer fit (height or width)", () => {
    // 3 dòng cỡ 20: cao 20 + 2·20·1.15 = 66 + 2·pad 4 = 74.
    const b = { ...box("t"), lines: ["ab", "ab", "ab"], w: 100, h: 74, pad: 4, font_size: 20, line_height: 1.15 };
    expect(boxOverflows(b, METRICS, measure)).toBe(false);
    expect(boxOverflow({ ...b, h: 66 }, METRICS, measure)).toBeCloseTo(8);
    expect(boxOverflows({ ...b, h: 66 }, METRICS, measure)).toBe(true);
    // Dòng rộng 20 ký tự = 200px > 100 − 8.
    expect(boxOverflows({ ...b, lines: ["abcdefghijabcdefghij"] }, METRICS, measure)).toBe(true);
    expect(boxOverflows({ ...b, lines: [] }, METRICS, measure)).toBe(false);
  });

  it("ignores overflow within the cross-engine tolerance: max(2px, 4% of the box side)", () => {
    // Cao khối 66 + 2·pad = 74; box 100×73 tràn 1px — sai số làm tròn giữa render.py và trình duyệt.
    const b = { ...box("t"), lines: ["ab", "ab", "ab"], w: 100, h: 73, pad: 4, font_size: 20, line_height: 1.15 };
    expect(boxOverflow(b, METRICS, measure)).toBe(0);
    expect(boxOverflows(b, METRICS, measure)).toBe(false);
    // Tràn 30px trên box cao 44px: vượt dung sai, báo đúng số px đo thật.
    expect(boxOverflow({ ...b, h: 44 }, METRICS, measure)).toBeCloseTo(30);
    // Box cao 200px: dung sai 8px (4%) — tràn 6px bỏ qua, tràn 10px báo.
    const tall = { ...b, lines: Array(8).fill("ab"), h: 0 };
    const need = 20 + 7 * 20 * 1.15 + 8;
    expect(boxOverflows({ ...tall, h: need - 6 }, METRICS, measure)).toBe(false);
    expect(boxOverflows({ ...tall, h: need - 10 }, METRICS, measure)).toBe(true);
    // Chiều ngang: dòng 100px trong vùng 92px (tràn 8px > 4px của box rộng 100).
    expect(boxOverflow({ ...b, h: 74, lines: ["abcdefghij"] }, METRICS, measure)).toBeCloseTo(8);
    expect(boxOverflow({ ...b, h: 74, w: 95, lines: ["abcdefgh", "ab", "ab"] }, METRICS, measure)).toBe(0);
  });
});
