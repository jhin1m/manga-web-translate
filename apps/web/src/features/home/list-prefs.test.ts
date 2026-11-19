import { describe, expect, it } from "vitest";
import type { ChapterRow, SeriesListItem } from "../series/api.ts";
import {
  CHAPTER_SORTS,
  defaultPrefs,
  readPrefs,
  SERIES_SORTS,
  sortChapters,
  sortSeries,
  writePrefs,
} from "./list-prefs.ts";

const series = (id: string, title: string, created: string, activity: string, chapters: number) =>
  ({ id, title, created_at: created, last_activity_at: activity, chapter_count: chapters }) as SeriesListItem;
const chapter = (id: string, number: string, created: string, updated: string) =>
  ({ id, number, created_at: created, updated_at: updated }) as ChapterRow;

const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe("sortSeries", () => {
  const list = [
    series("a", "Đảo hoang", "2026-01-03T00:00:00Z", "2026-02-01T00:00:00Z", 3),
    series("b", "anh hùng 10", "2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z", 12),
    series("c", "Anh hùng 2", "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z", 1),
  ];

  it("sorts by latest activity, newest first by default", () => {
    expect(ids(sortSeries(list, "activity", "desc"))).toEqual(["b", "a", "c"]);
    expect(ids(sortSeries(list, "activity", "asc"))).toEqual(["c", "a", "b"]);
  });

  it("sorts names the Vietnamese way, ignoring case and comparing numbers as numbers", () => {
    expect(ids(sortSeries(list, "title", "asc"))).toEqual(["c", "b", "a"]);
    expect(ids(sortSeries(list, "title", "desc"))).toEqual(["a", "b", "c"]);
  });

  it("sorts by creation date and by chapter count", () => {
    expect(ids(sortSeries(list, "created", "desc"))).toEqual(["a", "c", "b"]);
    expect(ids(sortSeries(list, "chapters", "desc"))).toEqual(["b", "a", "c"]);
    expect(ids(sortSeries(list, "chapters", "asc"))).toEqual(["c", "a", "b"]);
  });

  it("keeps ties in a stable id order in both directions and leaves the input untouched", () => {
    const tied = [series("z", "X", "", "", 1), series("y", "X", "", "", 1)];
    expect(ids(sortSeries(tied, "chapters", "asc"))).toEqual(["y", "z"]);
    expect(ids(sortSeries(tied, "chapters", "desc"))).toEqual(["y", "z"]);
    expect(ids(tied)).toEqual(["z", "y"]);
  });
});

describe("sortChapters", () => {
  const list = [
    chapter("c10", "10", "2026-01-01T00:00:00Z", "2026-01-05T00:00:00Z"),
    chapter("c2", "2", "2026-01-03T00:00:00Z", "2026-01-02T00:00:00Z"),
    chapter("c10.5", "10.5", "2026-01-02T00:00:00Z", "2026-01-09T00:00:00Z"),
  ];

  it("sorts chapter numbers numerically, decimals included", () => {
    expect(ids(sortChapters(list, "number", "asc"))).toEqual(["c2", "c10", "c10.5"]);
    expect(ids(sortChapters(list, "number", "desc"))).toEqual(["c10.5", "c10", "c2"]);
  });

  it("sorts by last update and by creation date", () => {
    expect(ids(sortChapters(list, "updated", "desc"))).toEqual(["c10.5", "c10", "c2"]);
    expect(ids(sortChapters(list, "created", "asc"))).toEqual(["c10", "c10.5", "c2"]);
  });
});

describe("readPrefs / writePrefs", () => {
  const memory = (initial: Record<string, string> = {}) => {
    const data = { ...initial };
    return {
      data,
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => {
        data[k] = v;
      },
    };
  };

  it("defaults to the grid and the first sort option in its own direction", () => {
    expect(defaultPrefs(SERIES_SORTS)).toEqual({ view: "grid", sort: "activity", dir: "desc" });
    expect(defaultPrefs(CHAPTER_SORTS)).toEqual({ view: "grid", sort: "number", dir: "asc" });
    expect(readPrefs(undefined, "k", SERIES_SORTS)).toEqual(defaultPrefs(SERIES_SORTS));
  });

  it("round-trips what was written", () => {
    const s = memory();
    writePrefs(s, "k", { view: "list", sort: "title", dir: "desc" });
    expect(readPrefs(s, "k", SERIES_SORTS)).toEqual({ view: "list", sort: "title", dir: "desc" });
  });

  it("falls back field by field on broken or unknown values", () => {
    expect(readPrefs(memory({ k: "{not json" }), "k", SERIES_SORTS)).toEqual(defaultPrefs(SERIES_SORTS));
    expect(readPrefs(memory({ k: '"list"' }), "k", SERIES_SORTS)).toEqual(defaultPrefs(SERIES_SORTS));
    expect(readPrefs(memory({ k: '{"view":"list","sort":"nope","dir":"asc"}' }), "k", SERIES_SORTS)).toEqual({
      view: "list",
      sort: "activity",
      dir: "desc",
    });
    expect(readPrefs(memory({ k: '{"view":"tiles","sort":"title","dir":"up"}' }), "k", SERIES_SORTS)).toEqual({
      view: "grid",
      sort: "title",
      dir: "asc",
    });
  });

  it("survives a storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => writePrefs(broken, "k", defaultPrefs(CHAPTER_SORTS))).not.toThrow();
    expect(readPrefs(broken, "k", CHAPTER_SORTS)).toEqual(defaultPrefs(CHAPTER_SORTS));
  });
});
