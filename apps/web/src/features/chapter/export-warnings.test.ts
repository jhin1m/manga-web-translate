import { describe, expect, it } from "vitest";
import { box, doc, region } from "../editor/__tests__/fixtures.ts";
import { exportWarnings, warningLines } from "./export-warnings.ts";
import { pageRows, type Row } from "./text-table/rows.ts";

const row = (kind: Row["kind"], flags: Row["flags"]) => ({ kind, flags });

describe("exportWarnings", () => {
  it("counts failed pages, overflowing boxes and empty translations (empty SFX not counted)", () => {
    const w = exportWarnings(
      [
        { status: "failed", ai_update_available: false },
        { status: "ready", ai_update_available: false },
      ],
      [
        row("dialog", ["overflow"]),
        row("box", ["overflow"]),
        row("dialog", ["empty"]),
        row("sfx", ["sfx", "empty"]),
        row("free", []),
      ],
    );
    expect(w).toEqual({ failed: 1, notReady: 0, overflow: 2, empty: 1, aiPending: 0 });
    expect(warningLines(w)).toEqual(["1 trang lỗi xử lý", "2 khối tràn khung", "1 khối chưa có bản dịch"]);
  });

  it("pages still processing and pages with a pending AI update", () => {
    const w = exportWarnings(
      [
        { status: "translating", ai_update_available: false },
        { status: "ready", ai_update_available: true },
      ],
      [],
    );
    expect(w).toMatchObject({ failed: 0, notReady: 1, aiPending: 1 });
    expect(warningLines(exportWarnings([{ status: "ready", ai_update_available: false }], []))).toEqual([]);
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
    expect(exportWarnings([{ status: "ready", ai_update_available: false }], rows)).toMatchObject({ empty: 1 });
  });
});
