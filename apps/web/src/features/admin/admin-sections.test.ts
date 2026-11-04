import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS, groupedSections, parseSection, validSection } from "./admin-sections.ts";

describe("admin sections", () => {
  it("parses known ids and falls back to the first section", () => {
    expect(parseSection("pipeline")).toBe("pipeline");
    for (const bad of ["nope", "", undefined, null, 3, ["pipeline"]])
      expect(parseSection(bad)).toBe(ADMIN_SECTIONS[0].id);
  });

  it("lists system fonts under the System group", () => {
    expect(ADMIN_SECTIONS.find((s) => s.id === "fonts")).toMatchObject({ label: "Font hệ thống", group: "Hệ thống" });
    expect(parseSection("fonts")).toBe("fonts");
  });

  it("validSection drops unknown values instead of defaulting", () => {
    expect(validSection("pipeline")).toBe("pipeline");
    expect(validSection("nope")).toBeUndefined();
  });

  it("groups sections keeping declaration order, every section once", () => {
    const groups = groupedSections();
    expect(groups.flatMap((g) => g.sections.map((s) => s.id))).toEqual(ADMIN_SECTIONS.map((s) => s.id));
    expect(new Set(groups.map((g) => g.group)).size).toBe(groups.length);
  });
});
