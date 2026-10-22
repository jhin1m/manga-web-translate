import { describe, expect, it } from "vitest";
import { glossaryKey, scopePath } from "./api.ts";

describe("glossary scope", () => {
  const pair = { source_lang: "ja", target_lang: "en" } as const;

  it("glossary chung mang cặp trong query; series thì không", () => {
    expect(scopePath("w1", { pair })).toBe("/api/w/w1/glossary?source_lang=ja&target_lang=en");
    expect(scopePath("w1", { pair }, "/csv")).toBe("/api/w/w1/glossary/csv?source_lang=ja&target_lang=en");
    expect(scopePath("w1", { seriesId: "s1" }, "/csv")).toBe("/api/w/w1/series/s1/glossary/csv");
  });

  it("key tách theo cặp, cùng prefix [glossary, ws] để invalidate", () => {
    expect(glossaryKey("w1", { pair })).toEqual(["glossary", "w1", "ws", "ja", "en"]);
    expect(glossaryKey("w1", { seriesId: "s1" })).toEqual(["glossary", "w1", "s1"]);
  });
});
