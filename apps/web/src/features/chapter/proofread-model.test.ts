import { describe, expect, it } from "vitest";
import { sortSuggestions, suggestionState } from "./proofread-model.ts";

const s = { old: "Xin chao", suggestion: "Xin chào" };

describe("suggestionState", () => {
  it("chờ duyệt khi bản hiện tại = bản AI đã đọc; đã nhận khi = gợi ý (bỏ qua khác khoảng trắng)", () => {
    expect(suggestionState(s, "Xin chao")).toBe("pending");
    expect(suggestionState(s, " Xin  chào ")).toBe("applied");
  });
  it("xuống dòng tay là khác biệt thật (không gộp như dấu cách)", () => {
    const br = { old: "Xin chào\ncậu", suggestion: "Xin chào\ncậu ơi" };
    expect(suggestionState(br, "Xin chào\n  cậu ")).toBe("pending");
    expect(suggestionState(br, "Xin chào cậu")).toBe("stale");
  });
  it("lỗi thời khi khối đã bị sửa khác hoặc không còn", () => {
    expect(suggestionState(s, "Chào bạn")).toBe("stale");
    expect(suggestionState(s, undefined)).toBe("stale");
  });
});

describe("sortSuggestions", () => {
  it("theo trang rồi thứ tự khối", () => {
    const list = [
      { page_id: "b", region_id: "r0" },
      { page_id: "a", region_id: "r2" },
      { page_id: "a", region_id: "r1" },
    ];
    const ord = new Map([
      ["a", 0],
      ["b", 1],
    ]);
    const idx = new Map([
      ["a:r1", 0],
      ["a:r2", 1],
      ["b:r0", 0],
    ]);
    expect(sortSuggestions(list, ord, idx).map((x) => `${x.page_id}:${x.region_id}`)).toEqual(["a:r1", "a:r2", "b:r0"]);
  });
});
