import { describe, expect, it } from "vitest";
import { box, doc, region } from "../editor/__tests__/fixtures.ts";
import { exportWarnings, reviewCount, warningLines } from "./export-warnings.ts";
import { pageRows, type Row } from "./text-table/rows.ts";

const row = (kind: Row["kind"], flags: Row["flags"]) => ({ kind, flags });
const page = (status: Parameters<typeof exportWarnings>[0][number]["status"], ai_update_available = false) => ({
  status,
  ai_update_available,
});

describe("exportWarnings", () => {
  it("untranslated pages are said to be missing from the file", () => {
    const w = exportWarnings([page("prepared"), page("failed"), page("ready")], []);
    expect(w.untranslated).toBe(2);
    expect(warningLines(w, { includeUntranslated: false })[0]).toBe("2 trang chưa dịch → không có trong file");
  });

  it("the missing-pages warning disappears when untranslated pages are included", () => {
    const w = exportWarnings([page("prepared"), page("failed"), page("ready")], []);
    expect(warningLines(w, { includeUntranslated: true }).some((l) => l.includes("không có trong file"))).toBe(false);
  });

  it("each warning states its consequence", () => {
    const w = exportWarnings(
      [page("ready", true), page("ready")],
      [
        row("dialog", ["overflow"]),
        row("box", ["overflow"]),
        row("dialog", ["empty"]),
        row("sfx", ["sfx", "empty"]),
        row("free", []),
      ],
    );
    expect(w).toEqual({ untranslated: 0, overflow: 2, empty: 1, aiPending: 1 });
    expect(warningLines(w, { includeUntranslated: false })).toEqual([
      "1 khối chưa dịch → để trống chữ",
      "1 trang AI có bản mới → xuất bản đang hiện",
      "2 khối tràn khung → chữ có thể bị cắt",
    ]);
    expect(reviewCount(w)).toBe(4);
    expect(warningLines(exportWarnings([page("ready")], []), { includeUntranslated: false })).toEqual([]);
  });

  it("hidden pages are never exported, so they never count", () => {
    const w = exportWarnings([{ ...page("failed", true), skipped: true }, page("ready")], []);
    expect(w).toEqual({ untranslated: 0, overflow: 0, empty: 0, aiPending: 0 });
  });

  it("counts untranslated text regions only, never speech-bubble outlines", () => {
    const state = {
      ...doc(0),
      regions: [
        { ...region("bub", ""), kind: "bubble" as const, source_text: "" },
        region("a", ""),
        region("b", "Hai"),
      ],
      text_boxes: [box("tb", "b", "Hai")],
    };
    const rows = pageRows({ id: "p", ord: 0, ai_update_available: false }, state, () => false);
    expect(exportWarnings([page("ready")], rows)).toMatchObject({ empty: 1, untranslated: 0 });
  });
});
