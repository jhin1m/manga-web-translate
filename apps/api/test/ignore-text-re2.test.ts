/** Chữ bỏ qua phía API: regex chạy bằng RE2 (tuyến tính), cú pháp RE2 không hỗ trợ bị từ chối. */
import { compileIgnoreList, type IgnoreMatcher, isIgnoredText } from "@mtl/shared";
import { describe, expect, it } from "vitest";
import { compileIgnoreListRe2, ignoreEntryErrorRe2 } from "../src/lib/ignore-text.ts";

const nfd = "nhóm dịch".normalize("NFD");

describe("ignore text matcher with RE2", () => {
  const factories: [string, (list: string[]) => IgnoreMatcher][] = [
    ["native RegExp", (list) => compileIgnoreList(list)],
    ["RE2", compileIgnoreListRe2],
  ];

  describe.each(factories)("%s", (_name, compile) => {
    it("matches plain entries ignoring case, spaces and scheme", () => {
      expect(compile(["discord.gg"])("Join discord . gg / abc")).toBe(true);
      expect(compile(["https://discord.gg"])("DISCORD.GG/abc")).toBe(true);
      expect(compile(["discord.gg"])("Xin chào")).toBe(false);
    });

    it("matches regex entries on normalized text", () => {
      const m = compile(["/discord\\s*\\.\\s*gg/", "/^read at\\s\\w+$/"]);
      expect(m("DISCORD  .  GG")).toBe(true);
      expect(m("Read   at\nAsura")).toBe(true);
      expect(m("discord gh")).toBe(false);
    });

    it("matches Vietnamese in NFC and NFD, case-insensitively", () => {
      const m = compile(["/nhóm\\s+dịch/"]);
      expect(m(`Bản dịch bởi ${nfd.toUpperCase()}`)).toBe(true);
      expect(m(`bản dịch bởi ${nfd}`)).toBe(true);
      expect(compile([`/${nfd.replace(" ", "\\s+")}/`])("NHÓM DỊCH")).toBe(true);
      expect(m("nhóm khác")).toBe(false);
    });

    it("skips invalid entries", () => {
      expect(compile(["/(ab/", "asura"])("asura")).toBe(true);
      expect(compile(["/(ab/"])("(ab")).toBe(false);
    });
  });

  it("finishes a catastrophic-looking pattern in linear time", () => {
    // 5 lượng từ: qua được validation nhưng RegExp gốc (backtracking) mất bậc n^5 trên chuỗi không khớp.
    const m = compileIgnoreListRe2(["/\\w*\\w*\\w*\\w*\\w*!/"]);
    const text = `${"a".repeat(70)} ${"b".repeat(30)}`;
    const t0 = performance.now();
    expect(m(text)).toBe(false);
    expect(m(`${text}!`)).toBe(true);
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it("rejects what RE2 cannot compile, with the existing per-entry errors for the rest", () => {
    for (const bad of ["/(a)\\1b/", "/foo(?=bar)/", "/(?<=a)bcd/", "/(?<n>abc)\\k<n>/"]) {
      expect(ignoreEntryErrorRe2(bad), bad).not.toBeNull();
    }
    expect(ignoreEntryErrorRe2("/(ab/")).toBe("regex không hợp lệ");
    expect(ignoreEntryErrorRe2("/ab/")).toMatch(/tối thiểu 3/);
    expect(ignoreEntryErrorRe2("/discord\\s*\\.\\s*gg/")).toBeNull();
    // Cùng chốt với form web: mục web không chạy được an toàn thì API cũng không nhận.
    expect(ignoreEntryErrorRe2("/\\w*\\w*\\w*\\w*\\w*\\w*!/")).toMatch(/lượng từ/);
    expect(ignoreEntryErrorRe2("/(a+)+b/")).toMatch(/lồng nhau/);
    expect(isIgnoredText("x", ["/abc/"])).toBe(false);
  });
});
