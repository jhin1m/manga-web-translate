import { describe, expect, it } from "vitest";
import {
  API_ERROR_CODES,
  API_ERROR_MESSAGES_VI,
  apiErrorBody,
  apiErrorMessageVi,
  IGNORE_ISSUE_CODES,
  isApiErrorCode,
  splitApiErrorCode,
} from "../src/index.ts";

describe("api error contract", () => {
  it("body keeps the stable code, the old Vietnamese message and the params", () => {
    expect(apiErrorBody("chapter_number_taken", { number: "12" })).toEqual({
      error: "chapter_number_taken",
      message: "series đã có chương 12",
      params: { number: "12" },
    });
    expect(apiErrorBody("csv_empty")).toEqual({ error: "csv_empty", message: "CSV không có dòng nào", params: {} });
  });

  it("a variant code splits into the stable error plus the variant", () => {
    expect(apiErrorBody("chapter_busy.export")).toEqual({
      error: "chapter_busy",
      variant: "export",
      message: "chương đang xử lý — chờ xong rồi xuất",
      params: {},
    });
    expect(splitApiErrorCode("limit.system_fonts")).toEqual({ error: "limit", variant: "system_fonts" });
    expect(splitApiErrorCode("no_size")).toEqual({ error: "no_size" });
  });

  it("fills every placeholder and leaves regex syntax like {n,} alone", () => {
    expect(apiErrorMessageVi("regex_too_many_quantifiers", { max: 4 })).toBe("regex tối đa 4 lượng từ *, +, {n,}");
    expect(apiErrorMessageVi("limit.system_fonts", { max: 50, max_mb: 200 })).toBe(
      "font hệ thống tối đa 50 font hoặc 200MB",
    );
    expect(apiErrorMessageVi("skip_images_full")).toBe("Series đã có {count} ảnh tự bỏ (tối đa {max}).");
  });

  it("ignore-text reasons reuse their codes; every code has a non-empty message", () => {
    for (const code of IGNORE_ISSUE_CODES) expect(isApiErrorCode(code)).toBe(true);
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
    for (const code of API_ERROR_CODES) {
      expect(code).toMatch(/^[a-z_]+(\.[a-z_]+)?$/);
      expect(API_ERROR_MESSAGES_VI[code].trim()).not.toBe("");
    }
    expect(isApiErrorCode("chapter_busy")).toBe(false);
    expect(isApiErrorCode(42)).toBe(false);
  });
});
