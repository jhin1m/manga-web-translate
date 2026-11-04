/** Ước tính hiệu đính (thuần): khoảng USD + giây theo số trang, trung bình lịch sử, dữ liệu lịch sử hỏng → mặc định. */
import { describe, expect, it } from "vitest";
import { DEFAULT_PER_PAGE, estimateRange, perPageFromHistory } from "../src/billing/proofread-estimate.ts";

describe("proofread estimate", () => {
  it("scales with pages and price (USD / 1M token)", () => {
    const r = estimateRange(10, { in: 1, out: 10 }, DEFAULT_PER_PAGE);
    expect(r.usd.low).toBeCloseTo((10 * (2500 * 1 + 150 * 10)) / 1e6);
    expect(r.usd.high).toBeCloseTo((10 * (7000 * 1 + 1200 * 10)) / 1e6);
    expect(r.seconds).toEqual({ low: 50, high: 200 });
    expect(estimateRange(0, { in: 1, out: 10 }, DEFAULT_PER_PAGE).usd).toEqual({ low: 0, high: 0 });
  });

  it("history averages per page with a spread; empty or broken history → null", () => {
    const per = perPageFromHistory({ pages: 4, tokensIn: 16_000, tokensOut: 2000, seconds: 40 });
    expect(per?.tokensIn.low).toBeCloseTo(4000 * 0.8);
    expect(per?.tokensIn.high).toBeCloseTo(4000 * 1.4);
    expect(per?.seconds.low).toBeCloseTo(10 * 0.8);
    expect(perPageFromHistory({ pages: 0, tokensIn: 100, tokensOut: 1, seconds: 1 })).toBeNull();
    expect(perPageFromHistory({ pages: 3, tokensIn: 0, tokensOut: 0, seconds: 0 })).toBeNull();
    // Không có thời gian hợp lệ → giữ thời gian mặc định.
    expect(perPageFromHistory({ pages: 2, tokensIn: 10, tokensOut: 1, seconds: 0 })?.seconds).toEqual(
      DEFAULT_PER_PAGE.seconds,
    );
  });
});
