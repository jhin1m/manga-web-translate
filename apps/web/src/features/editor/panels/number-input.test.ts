import { describe, expect, it } from "vitest";
import { committedNumber, liveNumber } from "./number-input.ts";

describe("number input of the style panel", () => {
  it("typing 24 over the font size never clamps the partial '2' up to the minimum", () => {
    expect(liveNumber("2", 6, 200)).toBeNull();
    expect(liveNumber("24", 6, 200)).toBe(24);
  });

  it("empty / invalid / out-of-range text is not applied while typing", () => {
    expect(liveNumber("", 6, 200)).toBeNull();
    expect(liveNumber("abc", 6, 200)).toBeNull();
    expect(liveNumber("300", 6, 200)).toBeNull();
    expect(liveNumber("1.", 0.6, 3)).toBe(1);
  });

  it("leaving the field clamps, and keeps the old value for empty text", () => {
    expect(committedNumber("2", 6, 200)).toBe(6);
    expect(committedNumber("300", 6, 200)).toBe(200);
    expect(committedNumber("", 6, 200)).toBeNull();
    expect(committedNumber("0.75", 0.6, 3)).toBe(0.75);
  });
});
