import { API_ERROR_CODES, API_ERROR_MESSAGES_VI } from "@mtl/shared";
import { describe, expect, it } from "vitest";
import { BASE_MESSAGES } from "./locales.ts";

const dict: Readonly<Record<string, string | undefined>> = BASE_MESSAGES;

describe("API error codes", () => {
  it("every code has errors.<code> in vi.json, same sentence as the API fallback message", () => {
    for (const code of API_ERROR_CODES) {
      expect(dict[`errors.${code}`], code).toBe(API_ERROR_MESSAGES_VI[code]);
    }
  });
});
