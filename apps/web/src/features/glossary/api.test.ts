import { describe, expect, it } from "vitest";
import { glossaryKey, scopePath } from "./api.ts";

describe("glossary scope", () => {
  const pair = { source_lang: "ja", target_lang: "en" } as const;

  it("glossary chung mang cặp trong query; series thì không", () => {
    expect(scopePath({ pair })).toBe("/api/glossary?source_lang=ja&target_lang=en");
    expect(scopePath({ pair }, "/csv")).toBe("/api/glossary/csv?source_lang=ja&target_lang=en");
    expect(scopePath({ seriesId: "s1" }, "/csv")).toBe("/api/series/s1/glossary/csv");
  });

  it("key tách theo cặp, cùng prefix [glossary] để invalidate", () => {
    expect(glossaryKey({ pair })).toEqual(["glossary", "shared", "ja", "en"]);
    expect(glossaryKey({ seriesId: "s1" })).toEqual(["glossary", "s1"]);
  });
});
