import type { PageState } from "@mtl/shared";
import { describe, expect, it } from "vitest";
import { box, doc, region } from "../../editor/__tests__/fixtures.ts";
import { buildRows, filterRows, needsAttention, rowKeyOfBox, sameKindBoxIds } from "./rows.ts";

const pages = [
  { id: "p2", ord: 1, ai_update_available: true },
  { id: "p1", ord: 0, ai_update_available: false },
];

function page2(): PageState {
  const s = doc(1);
  return {
    ...s,
    regions: [
      { ...region("a", "Một"), flags: ["low_conf"] },
      { ...region("b", ""), kind: "text_free" },
      { ...region("c", "RẦM"), flags: ["sfx"] },
    ],
    text_boxes: [box("ta", "a", "Một"), box("free", null, "Tự gõ"), box("tall", "c", "RẦM")],
  };
}

describe("text table rows", () => {
  it("orders by page ord then region order; active page reads the unsaved doc, others the cache", () => {
    const saved = doc(2);
    const editing: PageState = {
      ...saved,
      regions: saved.regions.map((r, i) => (i === 0 ? { ...r, translation: "Chưa lưu" } : r)),
    };
    const rows = buildRows(
      pages,
      { p1: { state: saved }, p2: { state: page2() } },
      { pageId: "p1", doc: editing },
      () => false,
    );
    expect(rows.map((r) => r.key)).toEqual(["p1:r0", "p1:r1", "p2:a", "p2:b", "p2:c", "p2:free"]);
    expect(rows[0]).toMatchObject({ translation: "Chưa lưu", index: 1, ord: 0, boxId: "t0", kind: "dialog" });
    // Box không gắn region có dòng riêng.
    expect(rows[5]).toMatchObject({ regionId: null, boxId: "free", translation: "Tự gõ", kind: "box", index: 4 });
  });

  it("sets flags: overflow, low_conf, empty, sfx, ai_update", () => {
    const rows = buildRows(pages, { p2: { state: page2() } }, { pageId: null, doc: null }, (b) => b.id === "tall");
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by["p2:a"]?.flags).toEqual(["low_conf", "ai_update"]);
    expect(by["p2:b"]?.flags).toEqual(["empty", "ai_update"]);
    expect(by["p2:b"]?.kind).toBe("free");
    expect(by["p2:c"]?.flags).toEqual(["overflow", "sfx", "ai_update"]);
    expect(by["p2:c"]?.kind).toBe("sfx");
    expect(rows.every(needsAttention)).toBe(true);
    const plain = buildRows(pages, { p1: { state: doc(1) } }, { pageId: null, doc: null }, () => false);
    expect(plain[0]?.flags).toEqual([]);
    expect(needsAttention({ flags: ["sfx"] })).toBe(false);
  });

  it("reuses rows of unchanged pages via the memo", () => {
    const memo = new WeakMap();
    const cache = { p1: { state: doc(1) }, p2: { state: page2() } };
    const a = buildRows(pages, cache, { pageId: null, doc: null }, () => false, memo);
    const b = buildRows(pages, cache, { pageId: null, doc: null }, () => false, memo);
    expect(b[0]).toBe(a[0]);
  });

  it("maps a selected box to its row key", () => {
    const s = page2();
    expect(rowKeyOfBox("p2", { id: "ta", region_id: "a" }, s)).toBe("p2:a");
    expect(rowKeyOfBox("p2", { id: "free", region_id: null }, s)).toBe("p2:free");
    expect(rowKeyOfBox("p2", { id: "x", region_id: "gone" }, s)).toBe("p2:x");
  });

  it("filters to rows needing review / the active page, always keeping the row being edited", () => {
    const rows = buildRows(
      pages,
      { p1: { state: doc(1) }, p2: { state: page2() } },
      { pageId: null, doc: null },
      () => false,
    );
    expect(filterRows(rows, { review: false, page: false }, null)).toBe(rows);
    expect(filterRows(rows, { review: true, page: false }, null).map((r) => r.key)).not.toContain("p1:r0");
    expect(filterRows(rows, { review: true, page: false }, null, "p1:r0").map((r) => r.key)).toContain("p1:r0");
    expect(filterRows(rows, { review: false, page: true }, "p1").map((r) => r.key)).toEqual(["p1:r0"]);
  });

  it("drops the 'empty' flag (worker: blank crop, or no translation) once the block has a translation", () => {
    const s: PageState = {
      ...doc(0),
      regions: [
        { ...region("blank", ""), flags: ["empty"] },
        { ...region("typed", "Đã gõ"), flags: ["empty"] },
        { ...region("untranslated", "  ") },
      ],
      text_boxes: [],
    };
    const rows = buildRows(
      [{ id: "p", ord: 0, ai_update_available: false }],
      { p: { state: s } },
      { pageId: null, doc: null },
      () => false,
    );
    expect(rows.map((r) => r.flags)).toEqual([["empty"], [], ["empty"]]);
    expect(rows.map(needsAttention)).toEqual([true, false, true]);
  });

  it("skips speech-bubble outline regions: no row, no 'empty' flag, indices count text regions only", () => {
    const s: PageState = {
      ...doc(0),
      regions: [
        { ...region("bub", ""), kind: "bubble", source_text: "" },
        region("a", "Một"),
        { ...region("bub2", ""), kind: "bubble", source_text: "" },
        region("b", "Hai"),
      ],
      text_boxes: [box("ta", "a", "Một"), box("tb", "b", "Hai")],
    };
    const rows = buildRows(
      [{ id: "p", ord: 0, ai_update_available: false }],
      { p: { state: s } },
      { pageId: null, doc: null },
      () => false,
    );
    expect(rows.map((r) => [r.key, r.index])).toEqual([
      ["p:a", 1],
      ["p:b", 2],
    ]);
    expect(rows.some(needsAttention)).toBe(false);
    // Box gắn vào khung bóng thoại (không có dòng region) vẫn có dòng riêng.
    expect(rowKeyOfBox("p", { id: "x", region_id: "bub" }, s)).toBe("p:x");
  });

  it("regions whose source text matches the series' ignored text get no row, nor do their boxes", () => {
    const s: PageState = {
      ...doc(0),
      regions: [region("a", "Một"), { ...region("wm", ""), source_text: "Read at DISCORD.GG/abc" }, region("b", "Hai")],
      text_boxes: [box("ta", "a", "Một"), box("twm", "wm", ""), box("tb", "b", "Hai")],
    };
    const build = (ignore: string[]) =>
      buildRows(
        [{ id: "p", ord: 0, ai_update_available: false }],
        { p: { state: s } },
        { pageId: null, doc: null },
        () => false,
        undefined,
        ignore,
      ).map((r) => [r.key, r.index]);
    expect(build(["discord.gg"])).toEqual([
      ["p:a", 1],
      ["p:b", 2],
    ]);
    expect(build([])).toEqual([
      ["p:a", 1],
      ["p:wm", 2],
      ["p:b", 3],
    ]);
    // Chương dịch trước khi thêm mục: box watermark còn in chữ → giữ dòng để thấy và xoá.
    s.text_boxes[1] = box("twm", "wm", "Đọc tại discord");
    expect(build(["discord.gg"]).map(([k]) => k)).toEqual(["p:a", "p:wm", "p:b"]);
    // Box đã ẩn (ẩn hàng loạt theo chữ bỏ qua) → dòng biến mất.
    s.text_boxes[1] = { ...box("twm", "wm", "Đọc tại discord"), hidden: true };
    expect(build(["discord.gg"]).map(([k]) => k)).toEqual(["p:a", "p:b"]);
  });

  it("ignored text also matches across spaces and regex entries", () => {
    const s: PageState = {
      ...doc(0),
      regions: [region("a", "Một"), { ...region("wm", ""), source_text: "Read at DISCORD . GG/abc" }],
      text_boxes: [box("ta", "a", "Một"), box("twm", "wm", "")],
    };
    const keys = (ignore: string[]) =>
      buildRows(
        [{ id: "p", ord: 0, ai_update_available: false }],
        { p: { state: s } },
        { pageId: null, doc: null },
        () => false,
        undefined,
        ignore,
      ).map((r) => r.key);
    expect(keys(["discord.gg"])).toEqual(["p:a"]);
    expect(keys(["/discord\\s*\\.\\s*gg/"])).toEqual(["p:a"]);
    expect(keys(["/nothing here/"])).toEqual(["p:a", "p:wm"]);
  });

  it("same-kind boxes for 'apply style' skip the source box and hidden boxes", () => {
    const s = page2();
    s.text_boxes.push({ ...box("ta2", "a", "Hai"), hidden: true }, box("ta3", "a", "Ba"));
    expect(sameKindBoxIds(s, "dialog", "ta")).toEqual(["ta3"]);
    expect(sameKindBoxIds(s, "box", "x")).toEqual(["free"]);
  });
});
