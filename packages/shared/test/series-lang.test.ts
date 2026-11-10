import { describe, expect, it } from "vitest";
import { COMIC_KIND_SETTINGS, readingOrder } from "../src/series-lang.ts";

describe("readingOrder", () => {
  it.each([
    ["ja", "pages", "rtl"],
    ["en", "pages", "rtl"],
    ["ko", "pages", "ltr"],
    ["zh", "pages", "ltr"],
    ["ja", "strip", "ltr"],
    ["en", "strip", "ltr"],
    ["ko", "strip", "ltr"],
  ])("%s + %s → %s", (src, fmt, order) => {
    expect(readingOrder(src, fmt)).toBe(order);
  });
});

describe("COMIC_KIND_SETTINGS", () => {
  it("defaults every kind to an English source and keeps the page format per kind", () => {
    expect(COMIC_KIND_SETTINGS).toEqual({
      manga: { source_lang: "en", page_format: "pages" },
      manhwa: { source_lang: "en", page_format: "strip" },
      manhua: { source_lang: "en", page_format: "strip" },
    });
  });
});
