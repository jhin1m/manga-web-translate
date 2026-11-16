import { describe, expect, it } from "vitest";
import { chapterTitleFrom, matchSeries, parseChapterFilename, parseChapterNumber } from "./parse-chapter-filename.ts";

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

describe("chapter prefix must not match inside a word", () => {
  it("ignores a bare c / ch / ep that ends a word", () => {
    expect(parseChapterNumber("Chapter 3 - Arc 2")).toBe("3");
    expect(parseChapterNumber("Deep 5")).toBe("5");
    expect(parseChapterNumber("manga_c12.zip")).toBe("12");
    expect(parseChapterNumber("s2_ch10_v2.png")).toBe("10");
  });

  it("keeps the arc number in the title and dots in folder names", () => {
    expect(chapterTitleFrom("Chapter 3 - Arc 2", "X")).toBe("Arc 2");
    expect(chapterTitleFrom("Ch 3 - St.Louis", "X")).toBe("St.Louis");
    expect(parseChapterNumber("Ch 12.5")).toBe("12.5");
    expect(chapterTitleFrom("Ch 3 - Hồi kết.zip", "X")).toBe("Hồi kết");
  });
});

describe("chapterTitleFrom", () => {
  it("keeps the part after the chapter number", () => {
    expect(chapterTitleFrom("Chapter 105 - The Return", "Solo Leveling")).toBe("The Return");
    expect(chapterTitleFrom("Tên truyện - Chương 12.5 - Hồi kết", "Tên truyện")).toBe("Hồi kết");
  });

  it("returns empty when only the series name and number remain", () => {
    expect(chapterTitleFrom("Solo Leveling ch 105", "Solo Leveling")).toBe("");
    expect(chapterTitleFrom("013", "Solo Leveling")).toBe("");
    expect(chapterTitleFrom("105화", "Solo Leveling")).toBe("");
    expect(chapterTitleFrom("ch12.zip", "Solo Leveling")).toBe("");
  });

  it("keeps the name when the series is not at the start", () => {
    expect(chapterTitleFrom("[Nhóm X] Tên truyện ch 3", "Tên truyện")).toBe("[Nhóm X] Tên truyện");
  });

  it("caps the length at 200", () => {
    expect(chapterTitleFrom(`ch 1 ${"a".repeat(300)}`, "X")).toHaveLength(200);
  });
});
