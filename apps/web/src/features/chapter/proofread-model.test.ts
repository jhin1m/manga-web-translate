import { describe, expect, it } from "vitest";
import {
  estimateLines,
  estimateSummary,
  fmtDurationRange,
  fmtUsdRange,
  type ProofreadEstimate,
  pendingCount,
  sortSuggestions,
  suggestionState,
} from "./proofread-model.ts";

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

describe("proofread estimate text", () => {
  it("USD range: small values keep 3 decimals, tiny shows a floor", () => {
    expect(fmtUsdRange({ low: 0.012, high: 0.05 })).toBe("$0.012 – $0.050");
    expect(fmtUsdRange({ low: 0.4, high: 1.234 })).toBe("$0.40 – $1.23");
    expect(fmtUsdRange({ low: 0, high: 0.004 })).toBe("dưới $0.01");
  });
  it("duration in minutes, short runs under a minute", () => {
    expect(fmtDurationRange({ low: 10, high: 40 })).toBe("dưới 1 phút");
    expect(fmtDurationRange({ low: 100, high: 400 })).toBe("khoảng 2–7 phút");
    expect(fmtDurationRange({ low: 170, high: 190 })).toBe("khoảng 3 phút");
  });
  it("lists pages, model and unknown price (image notice is shown separately, always)", () => {
    const e: ProofreadEstimate = {
      pages: 12,
      provider: null,
      model: null,
      price_known: false,
      usd: { low: 0.1, high: 0.5 },
      seconds: { low: 60, high: 240 },
      basis: "default",
    };
    const lines = estimateLines(e).join("\n");
    expect(lines).toContain("12 trang");
    expect(lines).toContain("giá cao nhất");
    expect(lines).toContain("sơ bộ");
    const known = estimateLines({
      ...e,
      provider: "DeepSeek",
      model: "deepseek-flash",
      price_known: true,
      basis: "history",
    });
    expect(known[0]).toBe("12 trang · DeepSeek · deepseek-flash");
    expect(known.join("\n")).not.toContain("giá cao nhất");
  });
});

describe("estimateSummary", () => {
  const e: ProofreadEstimate = {
    pages: 12,
    provider: null,
    model: null,
    price_known: false,
    usd: { low: 0.012, high: 0.05 },
    seconds: { low: 120, high: 420 },
    basis: "default",
  };
  it("một dòng: trang, giá, thời gian; chưa gán model thì nói giá cao nhất", () => {
    expect(estimateSummary(e)).toBe("12 trang · $0.012 – $0.050 (giá cao nhất) · khoảng 2–7 phút");
  });
  it("giá đã biết thì không ghi chú thêm", () => {
    expect(estimateSummary({ ...e, price_known: true })).toBe("12 trang · $0.012 – $0.050 · khoảng 2–7 phút");
  });
});

describe("pendingCount", () => {
  const list = [
    { page_id: "p1", region_id: "r1", old: "a", suggestion: "b" },
    { page_id: "p1", region_id: "r2", old: "c", suggestion: "d" },
    { page_id: "p2", region_id: "r1", old: "e", suggestion: "f" },
  ];
  it("chỉ đếm gợi ý mà bản dịch hiện tại còn là bản AI đã đọc", () => {
    const now: Record<string, string> = { "p1:r1": "a", "p1:r2": "d", "p2:r1": "khác" };
    expect(pendingCount(list, (k) => now[k])).toBe(1);
  });
  it("khối không còn → lỗi thời, không đếm", () => {
    expect(pendingCount(list, () => undefined)).toBe(0);
  });
});
