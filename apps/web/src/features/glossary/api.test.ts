import { describe, expect, it } from "vitest";
import { glossaryKey, scopePath } from "./api.ts";

describe("glossary scope", () => {
  it("đường dẫn theo series", () => {
    expect(scopePath({ seriesId: "s1" })).toBe("/api/series/s1/glossary");
    expect(scopePath({ seriesId: "s1" }, "/csv")).toBe("/api/series/s1/glossary/csv");
  });

  it("key theo series, cùng prefix [glossary] để invalidate", () => {
    expect(glossaryKey({ seriesId: "s1" })).toEqual(["glossary", "s1"]);
  });
});
