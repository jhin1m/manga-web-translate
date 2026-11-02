import { describe, expect, it } from "vitest";
import { hasTextStyleSlot, textStyleOptions } from "../panels/Properties.tsx";

describe("textStyleOptions", () => {
  it("lists Thường plus the styles that have a slot", () => {
    expect(textStyleOptions({ thought: "T" }, "normal")).toEqual(["normal", "thought"]);
    expect(textStyleOptions({ thought: "T", note: "O" }, "normal")).toEqual(["normal", "thought", "note"]);
  });

  it("keeps the region's current style even when its slot was cleared", () => {
    expect(textStyleOptions({ thought: "T" }, "note")).toEqual(["normal", "thought", "note"]);
  });
});

describe("hasTextStyleSlot", () => {
  it("hides the select until the series picks a thought or note font", () => {
    expect(hasTextStyleSlot({})).toBe(false);
    expect(hasTextStyleSlot({ thought: "" })).toBe(false);
    expect(hasTextStyleSlot({ note: "O" })).toBe(true);
  });
});
