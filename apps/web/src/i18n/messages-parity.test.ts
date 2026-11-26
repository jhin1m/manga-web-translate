import { describe, expect, it } from "vitest";
import { BASE_LOCALE, BASE_MESSAGES, LOCALES } from "./locales.ts";

const placeholders = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
const PLURAL_SUFFIX = /\.(zero|one|two|few|many|other)$/;

describe("message bundles", () => {
  it("the base bundle has no empty strings and every plural key has an .other form", () => {
    const keys = Object.keys(BASE_MESSAGES);
    for (const [key, value] of Object.entries(BASE_MESSAGES)) expect(value.trim(), key).not.toBe("");
    for (const key of keys.filter((k) => PLURAL_SUFFIX.test(k))) {
      expect(keys, `${key} needs a sibling .other`).toContain(key.replace(PLURAL_SUFFIX, ".other"));
    }
  });

  for (const def of LOCALES.filter((l) => l.code !== BASE_LOCALE)) {
    it(`${def.code} has the same keys and placeholders as the base, with no empty strings`, async () => {
      const messages: Readonly<Record<string, string | undefined>> = await def.load();
      expect(Object.keys(messages).sort()).toEqual(Object.keys(BASE_MESSAGES).sort());
      for (const [key, base] of Object.entries(BASE_MESSAGES)) {
        const value = messages[key] ?? "";
        expect(value.trim(), `${def.code}: ${key}`).not.toBe("");
        expect(placeholders(value), `${def.code}: ${key}`).toEqual(placeholders(base));
      }
    });
  }

  it("locale codes are unique and every locale has a native name", () => {
    const codes = LOCALES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const l of LOCALES) expect(l.native.trim()).not.toBe("");
  });
});
