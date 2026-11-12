import { MIN_TRIM_KEEP_PX } from "@mtl/shared";
import { describe, expect, it } from "vitest";
import { editTrim, parseTrimInput, savedEdges, trimDirty, trimPayload } from "./source-trim-model.ts";

const saved = (top: number, bottom: number, by: "user" | "credit" = "user") => ({ top, bottom, by });

describe("trimDirty", () => {
  it("no draft is never dirty", () => {
    expect(trimDirty(null, saved(0, 40))).toBe(false);
  });
  it("draft equal to the saved edges is not dirty", () => {
    expect(trimDirty({ top: 0, bottom: 40 }, saved(0, 40))).toBe(false);
    expect(trimDirty({ top: 0, bottom: 0 }, null)).toBe(false);
  });
  it("draft that differs from saved (or from nothing) is dirty", () => {
    expect(trimDirty({ top: 0, bottom: 41 }, saved(0, 40))).toBe(true);
    expect(trimDirty({ top: 5, bottom: 0 }, null)).toBe(true);
    expect(trimDirty({ top: 0, bottom: 0 }, saved(0, 40))).toBe(true);
  });
});

describe("trimPayload / savedEdges", () => {
  it("0 / 0 means remove the trim", () => {
    expect(trimPayload({ top: 0, bottom: 0 })).toBeNull();
    expect(trimPayload({ top: 0, bottom: 3 })).toEqual({ top: 0, bottom: 3 });
  });
  it("saved edges drop the origin tag", () => {
    expect(savedEdges(saved(4, 5, "credit"))).toEqual({ top: 4, bottom: 5 });
    expect(savedEdges(null)).toEqual({ top: 0, bottom: 0 });
  });
});

describe("parseTrimInput", () => {
  it("accepts digits, empty counts as 0", () => {
    expect(parseTrimInput("12")).toBe(12);
    expect(parseTrimInput("")).toBe(0);
    expect(parseTrimInput(" 7 ")).toBe(7);
  });
  it("rejects signs, decimals and exponents", () => {
    for (const bad of ["-3", "1.5", "1e3", "abc", "+4"]) expect(parseTrimInput(bad)).toBeNull();
  });
});

describe("editTrim", () => {
  it("clamps so at least MIN_TRIM_KEEP_PX stays", () => {
    const h = 300;
    expect(editTrim({ top: 0, bottom: 0 }, "top", 9999, h)).toEqual({ top: h - MIN_TRIM_KEEP_PX, bottom: 0 });
    expect(editTrim({ top: 100, bottom: 0 }, "bottom", 9999, h)).toEqual({
      top: 100,
      bottom: h - MIN_TRIM_KEEP_PX - 100,
    });
  });
  it("keeps the other edge when one changes", () => {
    expect(editTrim({ top: 10, bottom: 20 }, "top", 30, 300)).toEqual({ top: 30, bottom: 20 });
  });
});
