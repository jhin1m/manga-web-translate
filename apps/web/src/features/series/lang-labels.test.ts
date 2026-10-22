import { describe, expect, it } from "vitest";
import {
  addressPlaceholder,
  isTestedSource,
  LANG_NAMES,
  langShort,
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
});
