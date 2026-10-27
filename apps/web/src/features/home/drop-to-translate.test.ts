import { describe, expect, it } from "vitest";
import { toPageFile } from "../upload/files.ts";
import { chapterNumbers, dropGroups, latestChapterSeries, resolveDropSeries } from "./drop-to-translate.ts";

const solo = [{ id: "s1", title: "Solo Leveling" }];
const many = [...solo, { id: "s2", title: "Tower of God" }];

describe("resolveDropSeries", () => {
  it("(a) a fixed series always wins", () => {
    expect(resolveDropSeries({ fixedSeriesId: "s9", fileNames: ["tower-of-god-ch5.zip"], series: many })).toBe("s9");
  });

  it("(b) a file name containing an existing series title", () => {
    const r = resolveDropSeries({ fileNames: ["001.png", "Tower_of_God_ch5.zip"], series: many, recentSeriesId: "s1" });
    expect(r).toBe("s2");
  });

  it("(c) the series of the latest chapter when the name says nothing", () => {
    expect(resolveDropSeries({ fileNames: ["001.webp"], series: many, recentSeriesId: "s2" })).toBe("s2");
    // Series của chương gần nhất đã bị xoá → không dùng.
    expect(resolveDropSeries({ fileNames: ["001.webp"], series: many, recentSeriesId: "gone" })).toBeNull();
  });

  it("(d) the only series of the user; none or ambiguous → null", () => {
    expect(resolveDropSeries({ fileNames: ["001.webp"], series: solo })).toBe("s1");
    expect(resolveDropSeries({ fileNames: ["001.webp"], series: many })).toBeNull();
    expect(resolveDropSeries({ fileNames: ["001.webp"], series: [] })).toBeNull();
  });
});

describe("latestChapterSeries", () => {
  it("picks the series whose latest chapter was updated last", () => {
    const at = (t: string) => ({ updated_at: t }) as never;
    expect(
      latestChapterSeries([
        { id: "a", latest_chapter: at("2026-10-20T10:00:00Z") },
        { id: "b", latest_chapter: at("2026-10-21T10:00:00Z") },
        { id: "c", latest_chapter: null },
      ]),
    ).toBe("b");
    expect(latestChapterSeries([{ id: "c", latest_chapter: null }])).toBeNull();
  });
});

describe("chapterNumbers", () => {
  it("uses a free guess, otherwise the next free number", () => {
    expect(chapterNumbers(["12"], ["1", "2"])).toEqual(["12"]);
    expect(chapterNumbers(["2"], ["1", "2"])).toEqual(["3"]);
    expect(chapterNumbers([null], [])).toEqual(["1"]);
    expect(chapterNumbers([null, null], ["1", "2.5"])).toEqual(["3", "4"]);
    // Hai ZIP cùng số đoán: cái sau lấy số trống kế tiếp.
    expect(chapterNumbers(["5", "5", null], ["1"])).toEqual(["5", "2", "3"]);
  });
});

describe("dropGroups", () => {
  const png = (name: string) => toPageFile(name, new Blob([new Uint8Array(4)]));
  it("one chapter per ZIP (number from its name), loose images together (no number from page names)", () => {
    const g = dropGroups({
      zips: [
        { name: "ch-7.zip", pages: [png("1.png")] },
        { name: "empty.zip", pages: [] },
      ],
      loose: [png("001.png"), png("002.png")],
    });
    expect(g.map((x) => [x.pages.length, x.guess])).toEqual([
      [1, "7"],
      [2, null],
    ]);
    expect(dropGroups({ zips: [], loose: [png("chapter 42.png")] })[0]?.guess).toBe("42");
  });
});
