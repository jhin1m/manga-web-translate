import { describe, expect, it } from "vitest";
import { groupedSections, parseSection, SETTINGS_SECTIONS, validSection, visibleSections } from "./admin-sections.ts";

const ids = (list: readonly { id: string }[]) => list.map((s) => s.id);

describe("settings sections", () => {
  it("parses known ids and falls back to the first section (Font)", () => {
    expect(parseSection("pipeline")).toBe("pipeline");
    for (const bad of ["nope", "", undefined, null, 3, ["pipeline"]]) expect(parseSection(bad)).toBe("fonts");
  });

  it("fonts are a settings section shown first; signup/limits are gone (env only)", () => {
    expect(SETTINGS_SECTIONS[0].id).toBe("fonts");
    expect(validSection("fonts")).toBe("fonts");
    expect(validSection("limits")).toBeUndefined();
    expect(parseSection("limits")).toBe("fonts");
  });

  it("validSection drops unknown values instead of defaulting", () => {
    expect(validSection("pipeline")).toBe("pipeline");
    expect(validSection("nope")).toBeUndefined();
  });

  it("groups sections keeping declaration order, every section once", () => {
    const groups = groupedSections();
    expect(groups.flatMap((g) => ids(g.sections))).toEqual(ids(SETTINGS_SECTIONS));
    expect(new Set(groups.map((g) => g.group)).size).toBe(groups.length);
    expect(groups[0]?.group).toBe("Chung");
  });

  it("AI models live in the pipeline section; the old tasks link falls back to the first section", () => {
    expect(validSection("tasks")).toBeUndefined();
    expect(parseSection("tasks")).toBe("fonts");
  });

  it("admins see every section; local mode hides the users section", () => {
    expect(ids(visibleSections({ admin: true, localMode: false }))).toEqual([
      "fonts",
      "pipeline",
      "providers",
      "users",
    ]);
    const local = visibleSections({ admin: true, localMode: true });
    expect(ids(local)).toEqual(["fonts", "pipeline", "providers"]);
    expect(parseSection("users", local)).toBe("fonts");
    expect(groupedSections(local).flatMap((g) => ids(g.sections))).toEqual(ids(local));
  });

  it("regular users only see Font; an admin section in the URL falls back to Font", () => {
    for (const localMode of [false, true]) {
      const plain = visibleSections({ admin: false, localMode });
      expect(ids(plain)).toEqual(["fonts"]);
      expect(parseSection("pipeline", plain)).toBe("fonts");
      expect(validSection("providers", plain)).toBeUndefined();
      expect(groupedSections(plain).map((g) => g.group)).toEqual(["Chung"]);
    }
  });
});
