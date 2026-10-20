import { describe, expect, it } from "vitest";
import { matchSeries, parseChapterFilename, parseChapterNumber } from "./parse-chapter-filename.ts";

const series = [{ title: "Series A" }, { title: "Series AB" }, { title: "Thợ Săn Đêm" }, { title: "B" }];

describe("parseChapterFilename", () => {
  it("guesses series and number from a typical strip name", () => {
    expect(parseChapterFilename("seriesA_ch13.png", series)).toEqual({ series: series[0], number: "13" });
  });

  it("reads the number after chapter-like prefixes", () => {
    expect(parseChapterNumber("[Tên] Chapter 7.zip")).toBe("7");
    expect(parseChapterNumber("화 105.zip")).toBe("105");
    expect(parseChapterNumber("나혼렙 105화.zip")).toBe("105");
    expect(parseChapterNumber("Chương 012.zip")).toBe("12");
    expect(parseChapterNumber("vol2-ep 3.5.png")).toBe("3.5");
    expect(parseChapterNumber("s2_ch10_v2.png")).toBe("10");
  });

  it("falls back to the last number, or null without any", () => {
    expect(parseChapterNumber("series 2 - 41.png")).toBe("41");
    expect(parseChapterNumber("strip.png")).toBeNull();
  });

  it("matches series ignoring diacritics, case and punctuation; longest title wins", () => {
    expect(matchSeries("tho-san-dem_ch3.zip", series)).toBe(series[2]);
    expect(matchSeries("SERIES AB ch2.zip", series)).toBe(series[1]);
  });

  it("returns null series when nothing matches", () => {
    expect(parseChapterFilename("unknown_ch5.zip", [{ title: "Series A" }]).series).toBeNull();
  });
});
