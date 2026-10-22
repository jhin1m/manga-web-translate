import { describe, expect, it } from "vitest";
import {
  addressPlaceholder,
  isTestedSource,
  LANG_NAMES,
  langChangeWarning,
  langShort,
  pairLabel,
  SOURCE_LANGS,
  TARGET_LANGS,
} from "./lang-labels.ts";

describe("lang-labels", () => {
  it("mọi mã nguồn/đích đều có tên tiếng Việt", () => {
    for (const l of [...SOURCE_LANGS, ...TARGET_LANGS]) expect(LANG_NAMES[l]).toMatch(/^Tiếng /);
  });

  it("tên ngắn cho header; mã lạ giữ nguyên", () => {
    expect(`${langShort("ja")} → ${langShort("en")}`).toBe("Nhật → Anh");
    expect(langShort("xx")).toBe("xx");
  });

  it("placeholder xưng hô theo đích; chỉ tiếng Hàn đã kiểm định", () => {
    expect(addressPlaceholder("vi")).toBe("anh/em");
    expect(addressPlaceholder("fr")).toBe("cách gọi");
    expect(SOURCE_LANGS.filter(isTestedSource)).toEqual(["ko"]);
  });

  it("cảnh báo đổi ngôn ngữ chỉ khi cặp đổi và glossary riêng có từ", () => {
    const koVi = { source_lang: "ko", target_lang: "vi" };
    const koEn = { source_lang: "ko", target_lang: "en" };
    expect(pairLabel(koEn)).toBe("Hàn → Anh");
    expect(langChangeWarning(koVi, koVi, 3)).toBeNull();
    expect(langChangeWarning(koVi, koEn, 0)).toBeNull();
    expect(langChangeWarning(koVi, koEn, undefined)).toBeNull();
    expect(langChangeWarning(koVi, { source_lang: "ja", target_lang: "vi" }, 2)).toContain(
      "có 2 từ viết cho Hàn → Việt",
    );
    expect(langChangeWarning(koVi, koEn, 3)).toBe(
      "Glossary riêng của series có 3 từ viết cho Hàn → Việt — kiểm lại sau khi đổi ngôn ngữ. " +
        "Glossary chung sẽ chuyển sang cặp Hàn → Anh.",
    );
  });
});
