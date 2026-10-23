import { describe, expect, it } from "vitest";
import { parseIgnoreText } from "./ignore-text-input.ts";

describe("ignore text input", () => {
  it("one entry per line, blank lines dropped", () => {
    expect(parseIgnoreText(" discord.gg \n\nAsura Scans\n")).toEqual({
      list: ["discord.gg", "Asura Scans"],
      error: null,
    });
  });

  it("points at the first line that is too short or too long", () => {
    expect(parseIgnoreText("discord.gg\n\nab").error).toBe(
      "Dòng 3: mỗi mục 3–100 ký tự (không tính http:// và dấu cách).",
    );
    expect(parseIgnoreText("x".repeat(101)).error).toBe(
      "Dòng 1: mỗi mục 3–100 ký tự (không tính http:// và dấu cách).",
    );
    expect(parseIgnoreText("http://a").error).toBe("Dòng 1: mỗi mục 3–100 ký tự (không tính http:// và dấu cách).");
  });

  it("points at regex lines that do not compile, nest quantifiers or are too long", () => {
    expect(parseIgnoreText("discord.gg\n/(ab/").error).toBe("Dòng 2: regex không hợp lệ.");
    expect(parseIgnoreText("/(a+)+/").error).toMatch(/^Dòng 1: regex có lượng từ lồng nhau/);
    expect(parseIgnoreText(`/${"a".repeat(99)}/`).error).toMatch(/^Dòng 1: regex dài tối đa 100/);
    expect(parseIgnoreText("/discord\\s*\\.\\s*gg/").error).toBeNull();
  });

  it("caps the list at 50 entries", () => {
    const raw = Array.from({ length: 51 }, (_, i) => `mục ${i}`).join("\n");
    expect(parseIgnoreText(raw).error).toBe("Tối đa 50 mục.");
  });
});
