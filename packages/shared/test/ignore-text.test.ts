import { describe, expect, it } from "vitest";
import {
  cleanIgnoreList,
  compileIgnoreList,
  ignoreEntryError,
  isIgnoredText,
  isValidIgnoreEntry,
  parseIgnoreEntry,
} from "../src/ignore-text.ts";

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
    // độ dài đo sau khi bỏ khoảng trắng: "a   b" còn 2 ký tự
    expect(isValidIgnoreEntry("a   b")).toBe(false);
    expect(isValidIgnoreEntry("a b c")).toBe(true);
    expect(isValidIgnoreEntry("x".repeat(101))).toBe(false);
  });

  it("cleans the list: trims, drops blanks and case-insensitive duplicates", () => {
    expect(cleanIgnoreList([" discord.gg ", "DISCORD.GG", "", "asura"])).toEqual(["discord.gg", "asura"]);
    expect(cleanIgnoreList(["discord.gg", "discord . gg"])).toEqual(["discord.gg"]);
  });

  it("ignores whitespace on both sides when matching plain entries", () => {
    expect(isIgnoredText("Join discord . gg / abc", ["discord.gg"])).toBe(true);
    expect(isIgnoredText("discord.gg", ["discord . gg"])).toBe(true);
    expect(isIgnoredText("dis\ncord\u00a0.gg", ["discord.gg"])).toBe(true);
    expect(isIgnoredText("discord gh", ["discord.gg"])).toBe(false);
  });

  it("treats /pattern/ entries as case-insensitive regexes on the normalized text", () => {
    const m = compileIgnoreList(["/discord\\s*\\.\\s*gg/"]);
    expect(m("DISCORD . GG/abc")).toBe(true);
    expect(m("discord.gg")).toBe(true);
    expect(m("discord gg")).toBe(false);
    // chạy trên chữ đã chuẩn hoá (scheme bị bỏ, khoảng trắng gộp thành 1 dấu cách)
    expect(compileIgnoreList(["/^read at\\s\\w+$/"])("Read   at\nAsura")).toBe(true);
    expect(compileIgnoreList(["/^https/"])("https://x.com")).toBe(false);
  });

  it("matches regexes against Vietnamese text in NFC whatever the input form", () => {
    const m = compileIgnoreList(["/nhóm\\s+dịch/"]);
    expect(m("Bản dịch bởi NHÓM DỊCH mèo".normalize("NFD"))).toBe(true);
    expect(compileIgnoreList(["/nhóm\\s+dịch/".normalize("NFD")])("nhóm dịch")).toBe(true);
  });

  it("combines plain and regex entries; invalid entries are skipped", () => {
    const m = compileIgnoreList(["asura", "/(ab/", "/zzz+/"]);
    expect(m("Asura Scans")).toBe(true);
    expect(m("zzzz")).toBe(true);
    expect(m("hello")).toBe(false);
    expect(compileIgnoreList([])("anything")).toBe(false);
  });

  it("rejects regexes that do not compile, are too long, or are too short", () => {
    expect(ignoreEntryError("/(ab/")).toBe("regex không hợp lệ");
    expect(ignoreEntryError("/[a-z/")).toBe("regex không hợp lệ");
    expect(ignoreEntryError(`/${"a".repeat(99)}/`)).toMatch(/dài tối đa 100/);
    expect(ignoreEntryError(`/${"a".repeat(98)}/`)).toBeNull();
    expect(ignoreEntryError("/ab/")).toMatch(/tối thiểu 3/);
    expect(isValidIgnoreEntry("/discord\\s*\\.\\s*gg/")).toBe(true);
  });

  it("rejects regexes that match the empty string", () => {
    expect(ignoreEntryError("/a*b*/")).toMatch(/rỗng/);
    expect(ignoreEntryError("/(abc)?/")).toMatch(/rỗng/);
  });

  it("blocks nested quantifiers but not ordinary groups", () => {
    for (const bad of [
      "/(a+)+/",
      "/(.*)*/",
      "/(a|b+)*c/",
      "/((a+))+/",
      "/(a+){2,}/",
      "/(?:x*y?)+z/",
      "/(\\d+\\s)*end/",
    ]) {
      expect(ignoreEntryError(bad), bad).toMatch(/lồng nhau/);
    }
    for (const ok of ["/(abc)+/", "/(a|b)c+/", "/(ab)?cd+/", "/[(a+]+x/", "/\\(a+\\)+/", "/(ab){2}c/"]) {
      expect(ignoreEntryError(ok), ok).toBeNull();
    }
  });

  it("rejects syntax RE2 does not support (backreferences, lookaround)", () => {
    for (const bad of ["/(a)\\1b/", "/(?<n>a)\\k<n>/", "/foo(?=bar)/", "/foo(?!bar)/", "/(?<=a)bcd/", "/(?<!a)bcd/"]) {
      expect(ignoreEntryError(bad), bad).toMatch(/tham chiếu ngược/);
    }
    for (const ok of ["/\\\\1abc/", "/[(?=]abc/", "/\\(?=abc/", "/(?:abc)+/", "/(?<n>abc)/"]) {
      expect(ignoreEntryError(ok), ok).toBeNull();
    }
  });

  it("caps unbounded quantifiers so the native RegExp used for display cannot blow up", () => {
    expect(ignoreEntryError("/\\w*\\w*\\w*\\w*\\w*\\w*\\w*\\w*!/")).toMatch(/lượng từ/);
    expect(ignoreEntryError("/a*b+c*d+e*f/")).toBeNull();
    expect(ignoreEntryError("/a{2,}b+c*d+e*f+/")).toMatch(/lượng từ/);
    expect(ignoreEntryError("/[*+]{1,3}x\\*\\+yz/")).toBeNull();
  });

  it("uses the injected regex factory and reports its errors as invalid", () => {
    const seen: string[] = [];
    const makeRegex = (pattern: string, flags: string) => {
      seen.push(`${pattern}|${flags}`);
      if (pattern === "boom") throw new Error("nope");
      return { test: (t: string) => t.includes("hit") };
    };
    expect(compileIgnoreList(["/Hit+me/"], { makeRegex })("a hit b")).toBe(true);
    expect(seen).toContain("Hit+me|iu");
    expect(ignoreEntryError("/boom/", { makeRegex })).toBe("regex không hợp lệ");
  });

  it("treats a leading or trailing slash alone as plain text", () => {
    expect(isIgnoredText("see /r/manga/ now", ["/r/manga"])).toBe(true);
    expect(parseIgnoreEntry("/abc").kind).toBe("text");
  });
});
