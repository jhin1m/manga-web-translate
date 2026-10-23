/** Lọc chữ bỏ qua lúc claim: vùng OCR khớp → `empty` (không dịch), còn lại giữ nguyên. */
import { compileIgnoreList, type OcrResult } from "@mtl/shared";
import { describe, expect, it } from "vitest";
import { withoutIgnored } from "../src/jobs/claim-inputs.ts";

const item = (id: string, source: string) => ({
  id,
  source,
  is_sfx: false,
  empty: false,
  confidence: 0.9,
  low_conf: false,
});
const ocr: OcrResult = {
  regions: [],
  items: [item("a", "Đọc tại DISCORD . GG/abc"), item("b", "Xin chào"), item("c", "asura   scans"), item("d", "zzzz")],
};

describe("withoutIgnored", () => {
  it("marks matching items empty (plain, spaced and regex entries) and leaves the rest untouched", () => {
    const out = withoutIgnored(ocr, compileIgnoreList(["discord.gg", "Asura Scans", "/z{3,}/"]));
    expect(out.items.map((i) => [i.id, i.empty])).toEqual([
      ["a", true],
      ["b", false],
      ["c", true],
      ["d", true],
    ]);
    expect(out.items[0]?.source).toBe("Đọc tại DISCORD . GG/abc");
  });

  it("an empty list changes nothing", () => {
    expect(withoutIgnored(ocr, compileIgnoreList([])).items.every((i) => !i.empty)).toBe(true);
  });
});
