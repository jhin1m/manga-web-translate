import { describe, expect, it } from "vitest";
import { toPageFile } from "../upload/files.ts";
import {
  chapterNumbers,
  dropGroups,
  latestChapterSeries,
  readDropped,
  resolveDropSeries,
} from "./drop-to-translate.ts";

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
        { name: "ch-7.zip", path: "ch-7.zip", pages: [png("1.png")] },
        { name: "empty.zip", path: "empty.zip", pages: [] },
      ],
      folders: [],
      loose: [png("001.png"), png("002.png")],
    });
    expect(g.map((x) => [x.pages.length, x.guess, x.name])).toEqual([
      [1, "7", "ch-7.zip"],
      [2, null, null],
    ]);
    expect(dropGroups({ zips: [], folders: [], loose: [png("chapter 42.png")] })[0]?.guess).toBe("42");
  });

  it("one chapter per folder, sorted naturally by path together with ZIPs; empty folders are dropped", () => {
    const g = dropGroups({
      zips: [{ name: "ch 9.5.zip", path: "s/ch 9.5.zip", pages: [png("1.png")] }],
      folders: [
        { name: "ch 10", path: "s/ch 10", pages: [png("1.png"), png("2.png")] },
        { name: "ch 9", path: "s/ch 9", pages: [png("1.png")] },
        { name: "ch 11", path: "s/ch 11", pages: [] },
      ],
      loose: [],
    });
    expect(g.map((x) => [x.name, x.guess])).toEqual([
      ["ch 9", "9"],
      ["ch 9.5.zip", "9.5"],
      ["ch 10", "10"],
    ]);
  });
});

describe("readDropped", () => {
  const withPath = (path: string, size = 4) => {
    const f = new File([new Uint8Array(size)], path.split("/").pop() ?? path);
    Object.defineProperty(f, "webkitRelativePath", { value: path });
    return f;
  };
  it("groups images by their folder, skips junk, keeps root files as loose", async () => {
    const d = await readDropped([
      withPath("s/ch 10/2.png"),
      withPath("s/ch 10/10.png"),
      withPath("s/ch 10/.DS_Store"),
      withPath("s/ch 9/1.png"),
      withPath("s/__MACOSX/x.png"),
      new File([new Uint8Array(4)], "cover.png"),
    ]);
    expect(d.folders.map((f) => [f.name, f.path, f.pages.map((p) => p.name)])).toEqual([
      ["ch 9", "s/ch 9", ["1.png"]],
      ["ch 10", "s/ch 10", ["2.png", "10.png"]],
    ]);
    expect(d.loose.map((p) => p.name)).toEqual(["cover.png"]);
    expect(d.zips).toEqual([]);
  });

  it("silently skips non-image files inside folders and flags loose non-images", async () => {
    const d = await readDropped([
      withPath("s/ch 1/1.png"),
      withPath("s/ch 1/readme.txt"),
      withPath("s/ch 1/site.url"),
      new File([new Uint8Array(4)], "notes.txt"),
    ]);
    expect(d.folders.map((f) => f.pages.map((p) => p.name))).toEqual([["1.png"]]);
    // File lẻ ở gốc giữ nguyên để báo lỗi định dạng.
    expect(d.loose.map((p) => [p.name, p.problem])).toEqual([["notes.txt", "chỉ nhận png/jpg/webp"]]);
  });

  it("yields no chapter for a folder with only skipped files", async () => {
    const d = await readDropped([withPath("s/ch 1/readme.txt"), withPath("s/ch 1/.DS_Store")]);
    expect(d).toEqual({ zips: [], folders: [], loose: [] });
    expect(dropGroups(d)).toEqual([]);
  });

  it("returns nothing for no files", async () => {
    expect(await readDropped([])).toEqual({ zips: [], folders: [], loose: [] });
  });
});
