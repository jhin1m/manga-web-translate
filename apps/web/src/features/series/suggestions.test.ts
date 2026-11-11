import { pronounKey } from "@mtl/shared";
import { describe, expect, it } from "vitest";
import type { PronounSuggestion } from "./api.ts";
import { hasAcceptedRule, neighborId, pendingPronouns, ruleFromSuggestion } from "./suggestions.ts";

const sug = (speaker: string, listener: string, address = "anh/em"): PronounSuggestion => ({
  id: `${speaker}-${listener}`,
  speaker,
  listener,
  address,
  chapter_number: "1",
  created_at: "2026-11-11T00:00:00.000Z",
});
const rule = (speaker: string, listener: string) => ({ speaker, listener, address: "x", note: "" });

describe("pendingPronouns", () => {
  it("drops pairs already in the table, ignoring case and extra whitespace", () => {
    const list = [sug("Minjun", "Seoyeon"), sug("Haru", "Mina")];
    expect(pendingPronouns(list, [rule("  minjun ", "SEOYEON")]).map((s) => s.id)).toEqual(["Haru-Mina"]);
  });

  it("keeps the reversed pair", () => {
    const list = [sug("Seoyeon", "Minjun")];
    expect(pendingPronouns(list, [rule("Minjun", "Seoyeon")])).toHaveLength(1);
  });

  it("returns everything for an empty table", () => {
    const list = [sug("A", "B")];
    expect(pendingPronouns(list, [])).toEqual(list);
  });
});

describe("ruleFromSuggestion", () => {
  it("copies the three fields and leaves the note empty", () => {
    expect(ruleFromSuggestion(sug("Minjun", "Seoyeon"))).toEqual({
      speaker: "Minjun",
      listener: "Seoyeon",
      address: "anh/em",
      note: "",
    });
  });
});

describe("hasAcceptedRule", () => {
  it("is true only while a row for an accepted pair is still in the table", () => {
    const accepted = new Set([pronounKey("Minjun", "Seoyeon")]);
    expect(hasAcceptedRule(new Set(), [rule("Minjun", "Seoyeon")])).toBe(false);
    expect(hasAcceptedRule(accepted, [rule("Minjun", "Seoyeon")])).toBe(true);
    expect(hasAcceptedRule(accepted, [rule("Other", "Seoyeon")])).toBe(false);
    expect(hasAcceptedRule(accepted, [])).toBe(false);
  });
});

describe("neighborId", () => {
  it("prefers the next row, then the previous one, then null", () => {
    expect(neighborId(["a", "b", "c"], "a")).toBe("b");
    expect(neighborId(["a", "b", "c"], "c")).toBe("b");
    expect(neighborId(["a"], "a")).toBeNull();
    expect(neighborId(["a"], "zzz")).toBeNull();
  });
});
