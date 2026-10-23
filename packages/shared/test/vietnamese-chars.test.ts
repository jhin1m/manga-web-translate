import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { vietnameseChars } from "../src/vietnamese-chars.ts";

describe("vietnameseChars", () => {
  it("matches the golden list the worker is also tested against", () => {
    const golden = readFileSync(new URL("../../../worker/fonts/vietnamese-chars.txt", import.meta.url), "utf8").trim();
    expect(vietnameseChars()).toBe(golden);
  });

  it("is NFC, includes stacked tones and đ", () => {
    const chars = vietnameseChars();
    for (const ch of ["ế", "Ệ", "ữ", "Đ", "đ", "ặ"]) expect(chars).toContain(ch);
    expect(chars.normalize("NFC")).toBe(chars);
  });
});
