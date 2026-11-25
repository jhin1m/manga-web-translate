import { describe, expect, it } from "vitest";
import { buildPatch, type SettingsValues } from "./settings-diff.ts";

const r1 = { speaker: "Minjun", listener: "Seoyeon", address: "anh/em", note: "" };
const r2 = { speaker: "Seoyeon", listener: "Minjun", address: "em/anh", note: "" };
const base: SettingsValues = {
  title: "Series",
  source_lang: "ko",
  target_lang: "vi",
  page_format: "strip",
  honorific_policy: "translate",
  pronoun_rules: [r1, r2],
  style_prompt: "",
  default_fonts: { dialogue: "a.ttf", narration: "b.ttf" },
  ignore_text: ["discord.gg/x"],
};
const seen = ["minjun→seoyeon", "seoyeon→minjun"];

describe("buildPatch", () => {
  it("returns null when nothing changed", () => {
    expect(buildPatch(base, structuredClone(base))).toBeNull();
  });

  it("ignores origin labels and object key order", () => {
    const form: SettingsValues = {
      ...base,
      pronoun_rules: base.pronoun_rules.map((r) => ({ ...r, origin: "user" as const })),
      default_fonts: { narration: "b.ttf", dialogue: "a.ttf" },
    };
    expect(buildPatch(base, form)).toBeNull();
  });

  it("sends only changed fields plus the keys of the pairs the form started with", () => {
    expect(buildPatch(base, { ...base, honorific_policy: "keep" })).toEqual({
      honorific_policy: "keep",
      pronoun_keys_seen: seen,
    });
  });

  it("never sends style_prompt when only the incoming series changed it after mount", () => {
    // Prop `series` được poll lại với Giọng văn AI vừa điền; mốc vẫn là lúc mở, form giữ giá trị lúc mở.
    const form: SettingsValues = { ...base, title: "Tên mới" };
    const patch = buildPatch(base, form);
    expect(patch).toEqual({ title: "Tên mới", pronoun_keys_seen: seen });
    expect(patch).not.toHaveProperty("style_prompt");
  });

  it("sends the whole pronoun table without origin when a row changed", () => {
    const edited = { ...r1, address: "tớ/cậu", origin: "user" as const };
    const form: SettingsValues = { ...base, pronoun_rules: [edited, r2] };
    expect(buildPatch(base, form)).toEqual({
      pronoun_rules: [{ speaker: "Minjun", listener: "Seoyeon", address: "tớ/cậu", note: "" }, r2],
      pronoun_keys_seen: seen,
    });
  });

  it("sends removed rows and changed nested values", () => {
    const patch = buildPatch(base, {
      ...base,
      pronoun_rules: [],
      default_fonts: { dialogue: "a.ttf" },
      ignore_text: [],
    });
    expect(patch).toEqual({
      pronoun_rules: [],
      default_fonts: { dialogue: "a.ttf" },
      ignore_text: [],
      pronoun_keys_seen: seen,
    });
  });

  it("normalizes the seen keys like the server", () => {
    const b: SettingsValues = {
      ...base,
      pronoun_rules: [{ speaker: " Min  Jun ", listener: "SEO", address: "a", note: "" }],
    };
    expect(buildPatch(b, { ...b, style_prompt: "giọng trẻ" })?.pronoun_keys_seen).toEqual(["min jun→seo"]);
  });

  it("keeps an empty seen list when the form started without pairs", () => {
    const b: SettingsValues = { ...base, pronoun_rules: [] };
    expect(buildPatch(b, { ...b, style_prompt: "x" })).toEqual({ style_prompt: "x", pronoun_keys_seen: [] });
  });
});
