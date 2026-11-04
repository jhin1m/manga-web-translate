import { describe, expect, it } from "vitest";
import { type ConfirmRequired, canEnableSignup, confirmWarnings, fmtUsd, parseUsd, usdText } from "./limits-model.ts";

describe("parseUsd", () => {
  it("blank = follow env; numbers >= 0 parse (comma ok); the rest is invalid", () => {
    expect(parseUsd("")).toBeNull();
    expect(parseUsd("  ")).toBeNull();
    expect(parseUsd("0")).toBe(0);
    expect(parseUsd("2,5")).toBe(2.5);
    expect(parseUsd(" 10.25 ")).toBe(10.25);
    for (const bad of ["-1", "abc", "1e3", "Infinity", "1.", ".5", "1 2"]) expect(parseUsd(bad), bad).toBe("invalid");
  });
  it("usdText round-trips stored values", () => {
    expect(usdText(null)).toBe("");
    expect(parseUsd(usdText(3.5))).toBe(3.5);
  });
});

describe("canEnableSignup", () => {
  const none = { user_daily_usd: null, global_daily_usd: null };
  it("needs both effective limits (typed or env)", () => {
    expect(canEnableSignup("1", "10", none)).toBe(true);
    expect(canEnableSignup("1", "", none)).toBe(false);
    expect(canEnableSignup("", "", { user_daily_usd: 1, global_daily_usd: 10 })).toBe(true);
    expect(canEnableSignup("0", "0", none)).toBe(true);
    expect(canEnableSignup("x", "10", none)).toBe(false);
  });
});

describe("usdText", () => {
  it("never uses exponent notation and trims trailing zeros", () => {
    expect(usdText(null)).toBe("");
    expect(usdText(0)).toBe("0");
    expect(usdText(10)).toBe("10");
    expect(usdText(2.5)).toBe("2.5");
    expect(usdText(1e-7)).toBe("0.0000001");
    expect(parseUsd(usdText(1e-7))).toBe(1e-7);
  });
});

describe("confirmWarnings", () => {
  const base: ConfirmRequired = {
    max_user_spent_usd: 2.5,
    global_spent_usd: 7,
    user_over: true,
    global_over: false,
    user_jobs: 3,
    global_jobs: null,
  };
  it("user warning names the new limit, the highest spend and affected jobs", () => {
    const [w, ...rest] = confirmWarnings(base, { user: 1, global: null });
    expect(rest).toEqual([]);
    expect(w).toContain("$1");
    expect(w).toContain("$2.5");
    expect(w).toContain("3 job AI");
    expect(w).toContain("Chạy lại trang lỗi");
  });
  it("global warning names the total spent and paused_budget; both can show together", () => {
    const both = confirmWarnings({ ...base, global_over: true, global_jobs: 4 }, { user: 1, global: 5 });
    expect(both).toHaveLength(2);
    expect(both[1]).toContain("$5");
    expect(both[1]).toContain("$7");
    expect(both[1]).toContain("paused_budget");
  });
  it("no warning for a limit that is not over", () => {
    expect(confirmWarnings({ ...base, user_over: false }, { user: 1, global: 5 })).toEqual([]);
  });
  it("fmtUsd trims float noise", () => {
    expect(fmtUsd(0.1 + 0.2)).toBe("$0.3");
  });
});
