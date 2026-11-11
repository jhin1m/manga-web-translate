import { describe, expect, it } from "vitest";
import { normKey, pronounKey, termKey } from "../src/index.ts";

describe("series suggestion keys", () => {
  it("treats NFD and NFC Hangul as the same key", () => {
    const nfc = "민준".normalize("NFC");
    const nfd = "민준".normalize("NFD");
    expect(nfd).not.toBe(nfc);
    expect(termKey(nfd)).toBe(termKey(nfc));
  });

  it("ignores case, outer and repeated whitespace", () => {
    expect(normKey("  Min   JUN \t")).toBe("min jun");
    expect(termKey("Min Jun")).toBe(termKey(" min  jun "));
  });

  it("makes pronounKey ordered", () => {
    expect(pronounKey("A", "B")).toBe("a→b");
    expect(pronounKey("A", "B")).not.toBe(pronounKey("B", "A"));
    expect(pronounKey(" A ", "b")).toBe(pronounKey("a", "B"));
  });
});
