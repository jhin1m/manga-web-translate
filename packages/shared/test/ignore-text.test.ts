import { describe, expect, it } from "vitest";
import { cleanIgnoreList, isIgnoredText, isValidIgnoreEntry } from "../src/ignore-text.ts";

describe("ignore text", () => {
  it("matches when the OCR text contains an entry, ignoring case, scheme and extra spaces", () => {
    expect(isIgnoredText("Join us: DISCORD.GG/abc", ["discord.gg"])).toBe(true);
    expect(isIgnoredText("discord.gg/abc", ["https://discord.gg"])).toBe(true);
    expect(isIgnoredText("https://discord.gg/abc", ["discord.gg"])).toBe(true);
    expect(isIgnoredText("Read  at\nAsura   Scans", ["asura scans"])).toBe(true);
    expect(isIgnoredText("Xin chào", ["discord.gg"])).toBe(false);
    expect(isIgnoredText("anything", [])).toBe(false);
    expect(isIgnoredText("anything", ["   "])).toBe(false);
  });

  it("compares Vietnamese text in NFC whatever the input form", () => {
    const nfd = "Nhóm Dịch Mèo".normalize("NFD");
    expect(isIgnoredText(`Bản dịch bởi ${nfd}`, ["nhóm dịch mèo"])).toBe(true);
    expect(isIgnoredText("Bản dịch bởi Nhóm Dịch Mèo", [nfd])).toBe(true);
  });

  it("checks length on the normalized form, so a scheme or NFD marks cannot pad a short entry", () => {
    expect(isValidIgnoreEntry("discord.gg")).toBe(true);
    expect(isValidIgnoreEntry("mèo")).toBe(true);
    expect(isValidIgnoreEntry("mèo".normalize("NFD"))).toBe(true);
    expect(isValidIgnoreEntry("http://a")).toBe(false);
    expect(isValidIgnoreEntry("https://")).toBe(false);
    expect(isValidIgnoreEntry("ắ".normalize("NFD"))).toBe(false);
    expect(isValidIgnoreEntry("a   b")).toBe(true);
    expect(isValidIgnoreEntry("x".repeat(101))).toBe(false);
  });

  it("cleans the list: trims, drops blanks and case-insensitive duplicates", () => {
    expect(cleanIgnoreList([" discord.gg ", "DISCORD.GG", "", "asura"])).toEqual(["discord.gg", "asura"]);
  });
});
