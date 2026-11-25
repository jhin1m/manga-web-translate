import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS, groupedSections, parseSection, validSection, visibleSections } from "./admin-sections.ts";

describe("admin sections", () => {
  it("parses known ids and falls back to the first section", () => {
    expect(parseSection("pipeline")).toBe("pipeline");
    for (const bad of ["nope", "", undefined, null, 3, ["pipeline"]])
      expect(parseSection(bad)).toBe(ADMIN_SECTIONS[0].id);
  });

  it("fonts are not a settings section (managed on /fonts); the old link falls back to the first section", () => {
    expect(validSection("fonts")).toBeUndefined();
    expect(parseSection("fonts")).toBe("pipeline");
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

  it("AI models live in the pipeline section; the old tasks link falls back to it", () => {
    expect(validSection("tasks")).toBeUndefined();
    expect(parseSection("tasks")).toBe("pipeline");
  });

  it("local mode hides multi-user sections (signup/limits, users) and parses against the filtered list", () => {
    const local = visibleSections(true);
    expect(local.map((s) => s.id)).toEqual(["pipeline", "providers"]);
    expect(visibleSections(false)).toEqual(ADMIN_SECTIONS);
    expect(parseSection("users", local)).toBe("pipeline");
    expect(validSection("limits", local)).toBeUndefined();
    expect(groupedSections(local).flatMap((g) => g.sections.map((s) => s.id))).toEqual(local.map((s) => s.id));
  });
});
