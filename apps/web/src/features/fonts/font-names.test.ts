import { describe, expect, it } from "vitest";
import { fontDisplayName, recommendedFirst } from "./font-names.ts";

describe("fontDisplayName", () => {
  it.each([
    ["MTOComic-Regular", "MTO Comic"],
    ["KomikaText-Regular", "Komika Text"],
    ["WildWords-Roman", "Wild Words"],
    ["WildWords-BoldItalic", "Wild Words Bold Italic"],
    ["AnimeAce3-Italic", "Anime Ace 3 Italic"],
    ["Baloo2-Variable", "Baloo 2"],
    ["BeVietnamPro-Bold", "Be Vietnam Pro Bold"],
    ["Anton-Regular", "Anton"],
  ])("%s → %s", (id, name) => {
    expect(fontDisplayName(id)).toBe(name);
  });
});

describe("recommendedFirst", () => {
  it("puts recommended fonts first and keeps the rest in order", () => {
    expect(recommendedFirst(["Anton-Regular", "BeVietnamPro-Regular", "Zoinks-Regular", "KomikaText-Regular"])).toEqual(
      ["KomikaText-Regular", "BeVietnamPro-Regular", "Anton-Regular", "Zoinks-Regular"],
    );
  });

  it("skips recommended fonts filtered out for the target language", () => {
    expect(recommendedFirst(["Anton-Regular"])).toEqual(["Anton-Regular"]);
  });
});
