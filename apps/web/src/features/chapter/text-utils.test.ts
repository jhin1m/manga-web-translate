import { describe, expect, it } from "vitest";
import { describeWriteError, formatBytes, splitHighlight } from "./text-utils.ts";

describe("formatBytes", () => {
  it("định dạng theo bậc", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(200 * 1024 * 1024)).toBe("200 MB");
  });
});

describe("splitHighlight", () => {
  it("không phân biệt hoa thường", () => {
    expect(splitHighlight("Hello hello", "hello", false)).toEqual([
      { text: "Hello", hit: true },
      { text: " ", hit: false },
      { text: "hello", hit: true },
    ]);
  });
  it("phân biệt hoa thường", () => {
    expect(splitHighlight("Hello hello", "hello", true).filter((p) => p.hit)).toHaveLength(1);
  });
  it("ký tự đặc biệt coi là chữ thường", () => {
    expect(splitHighlight("a.b a+b", "a.b", false).filter((p) => p.hit)).toHaveLength(1);
  });
  it("needle rỗng", () => {
    expect(splitHighlight("abc", "", false)).toEqual([{ text: "abc", hit: false }]);
  });
});

describe("describeWriteError", () => {
  it("map mã lỗi", () => {
    expect(describeWriteError(423, "chapter_locked", "x")).toMatch(/tab khác/);
    expect(describeWriteError(409, "preview_stale", "x")).toMatch(/Xem trước/);
    expect(describeWriteError(409, "undo_conflict", "x")).toMatch(/hoàn tác/);
    expect(describeWriteError(500, undefined, "boom")).toBe("boom");
  });
});
