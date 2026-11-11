import { describe, expect, it } from "vitest";
import { countSummary, firstMissingRuleField, rulesSummary, styleSummary } from "./settings-summary.ts";

const rule = (over: Partial<{ speaker: string; listener: string; address: string }> = {}) => ({
  speaker: "Minjun",
  listener: "Seoyeon",
  address: "anh/em",
  note: "",
  ...over,
});

describe("firstMissingRuleField", () => {
  it("returns null when every rule is complete (note is optional)", () => {
    expect(firstMissingRuleField([rule(), rule()])).toBeNull();
    expect(firstMissingRuleField([])).toBeNull();
  });

  it("points at the first empty field of the first incomplete rule", () => {
    expect(firstMissingRuleField([rule(), rule({ listener: "  " }), rule({ speaker: "" })])).toEqual({
      index: 1,
      field: "listener",
    });
    expect(firstMissingRuleField([rule({ address: "" })])).toEqual({ index: 0, field: "address" });
  });
});

describe("rulesSummary", () => {
  it("keeps the old text without pending suggestions", () => {
    expect(rulesSummary([rule(), rule()])).toBe("2 quy tắc");
    expect(rulesSummary([])).toBe("Chưa có");
    expect(rulesSummary([rule()], 0)).toBe("1 quy tắc");
  });

  it("appends the pending suggestion count", () => {
    expect(rulesSummary([rule(), rule()], 1)).toBe("2 quy tắc · 1 gợi ý");
    expect(rulesSummary([], 3)).toBe("Chưa có · 3 gợi ý");
  });
});

describe("summaries", () => {
  it("collapses whitespace in the style prompt and falls back when empty", () => {
    expect(styleSummary("  giọng trẻ,\n đời thường ")).toBe("giọng trẻ, đời thường");
    expect(styleSummary("   ")).toBe("Chưa đặt");
  });

  it("counts rules and items", () => {
    expect(rulesSummary([])).toBe("Chưa có");
    expect(rulesSummary([rule(), rule()])).toBe("2 quy tắc");
    expect(countSummary(0, "mục")).toBe("Chưa có");
    expect(countSummary(3, "ảnh")).toBe("3 ảnh");
  });
});
