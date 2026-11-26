import { describe, expect, it } from "vitest";
import { JobPayload } from "../src/job.ts";
import { defaultTargetLang, TARGET_LANGS } from "../src/series-lang.ts";
import { DEFAULT_UI_LOCALE, isUiLocale, UI_LOCALES } from "../src/ui-locale.ts";

const ID = "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b";
const settings = { glossary: {}, pronoun_rules: "", honorific_policy: "", style_prompt: "", font: "Bangers-Regular" };
const translate = {
  type: "chapter.translate",
  chapter_id: ID,
  page_ids: [ID],
  context: "rolling",
  glossary_rev: 0,
  settings_rev: 0,
  settings,
};
const proofread = { type: "chapter.proofread", chapter_id: ID, page_ids: [ID], settings };

describe("ui locales", () => {
  it("lists the web locales, defaults to vi and rejects unknown codes", () => {
    expect(UI_LOCALES).toEqual(["vi", "en"]);
    expect(DEFAULT_UI_LOCALE).toBe("vi");
    expect(isUiLocale("en")).toBe(true);
    expect(isUiLocale("fr")).toBe(false);
    expect(isUiLocale(null)).toBe(false);
  });

  it("every ui locale is a valid series target, so a new series can follow the interface language", () => {
    for (const l of UI_LOCALES) expect(TARGET_LANGS).toContain(l);
  });
});

describe("defaultTargetLang", () => {
  it.each([
    ["vi", "vi"],
    ["en", "en"],
    ["fr", "fr"],
    ["ja", "vi"],
    ["", "vi"],
  ])("%s → %s", (locale, tgt) => {
    expect(defaultTargetLang(locale)).toBe(tgt);
  });
});

describe("payload ui_lang", () => {
  it("translate and proofread payloads accept a ui locale and still parse without one (jobs queued earlier)", () => {
    for (const p of [translate, proofread]) {
      expect(JobPayload.safeParse(p).success).toBe(true);
      const r = JobPayload.safeParse({ ...p, ui_lang: "en" });
      expect(r.success && "ui_lang" in r.data && r.data.ui_lang).toBe("en");
    }
  });

  it("accepts any well-formed language code, so a new interface locale does not break running workers", () => {
    for (const p of [translate, proofread]) {
      for (const code of ["ja", "fil", "zh-Hant", "pt-BR"]) {
        expect(JobPayload.safeParse({ ...p, ui_lang: code }).success).toBe(true);
      }
    }
  });

  it.each(["", "e", "EN", "english", "en_US", "en-", "vi; drop", `en-${"a".repeat(40)}`])(
    "rejects malformed ui_lang %j",
    (code) => {
      for (const p of [translate, proofread]) expect(JobPayload.safeParse({ ...p, ui_lang: code }).success).toBe(false);
    },
  );
});
