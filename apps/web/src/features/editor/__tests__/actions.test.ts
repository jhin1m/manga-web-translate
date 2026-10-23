import type { PageState } from "@mtl/shared";
import { describe, expect, it } from "vitest";
import {
  addBox,
  applyRegionTranslation,
  contrastStroke,
  deleteBox,
  diffRegions,
  duplicateBox,
  editText,
  insertOcrRegion,
  moveBox,
  newTextBox,
  refreshRegionFromOcr,
  resetToAI,
  resizeBox,
  setRegionTranslation,
  setStyle,
  setStyleMany,
} from "../actions.ts";
import { change } from "../history.ts";
import { box, doc, layout, region } from "./fixtures.ts";

const run = (s: PageState, recipe: Parameters<typeof change<PageState>>[1]) => change(s, recipe).state;

describe("editor actions", () => {
  it("duplicateBox copies text and style at a 16px offset as a free box with a new id", () => {
    const s0 = doc(1);
    const src = s0.text_boxes[0];
    if (!src) throw new Error("no box");
    const r = change(s0, duplicateBox(src, "tb-copy"));
    const copy = r.state.text_boxes.find((b) => b.id === "tb-copy");
    expect(r.state.text_boxes).toHaveLength(2);
    expect(copy).toMatchObject({
      x: src.x + 16,
      y: src.y + 16,
      region_id: null,
      text: src.text,
      font_size: src.font_size,
    });
    expect(new Set(r.state.text_boxes.map((b) => b.id)).size).toBe(2);
    // Bản gốc không đổi, 1 bước hoàn tác trả về đúng state cũ.
    expect(r.state.text_boxes[0]).toEqual(src);
    expect(r.inverse.length).toBeGreaterThan(0);
    // Trùng id thì không thêm.
    expect(run(r.state, duplicateBox(src, "tb-copy")).text_boxes).toHaveLength(2);
  });

  it("moves and resizes; resize re-wraps lines", () => {
    let s = run(doc(1), moveBox("t0", 50, 60));
    expect(s.text_boxes[0]).toMatchObject({ x: 50, y: 60 });
    s = run(s, editText("t0", "Anh đang làm gì vậy", layout));
    s = run(s, resizeBox("t0", { x: 50, y: 60, w: 88, h: 120, rotation: 15 }, layout));
    expect(s.text_boxes[0]).toMatchObject({ w: 88, rotation: 15, lines: ["Anh đang", "làm gì", "vậy"] });
  });

  it("editText normalizes NFC and syncs the linked region translation", () => {
    const s = run(doc(1), editText("t0", "Tiếng Việt".normalize("NFD"), layout));
    expect(s.text_boxes[0]?.text).toBe("Tiếng Việt");
    expect(s.text_boxes[0]?.text).toBe(s.text_boxes[0]?.text.normalize("NFC"));
    expect(s.regions[0]?.translation).toBe("Tiếng Việt");
  });

  it("setStyle relayouts only for layout fields", () => {
    const base = run(doc(1), editText("t0", "Anh đang làm gì vậy", layout));
    const colored = run(
      base,
      setStyle("t0", { fill: "#ff0000" }, () => ({ lines: ["X"], font_size: 1 })),
    );
    expect(colored.text_boxes[0]?.lines).toEqual(base.text_boxes[0]?.lines);
    const fitted = run(base, setStyle("t0", { auto_fit: true }, layout));
    expect(fitted.text_boxes[0]?.font_size).not.toBe(20);
  });

  it("adds (no duplicate ids) and deletes boxes", () => {
    let s = run(doc(1), addBox(box("t9")));
    s = run(s, addBox(box("t9", null, "khác")));
    expect(s.text_boxes.map((b) => b.id)).toEqual(["t0", "t9"]);
    s = run(s, deleteBox("t0"));
    expect(s.text_boxes.map((b) => b.id)).toEqual(["t9"]);
  });

  it("setRegionTranslation updates region and linked boxes", () => {
    const s = run(doc(2), setRegionTranslation("r1", "Đi thôi", layout));
    expect(s.regions[1]?.translation).toBe("Đi thôi");
    expect(s.text_boxes[1]).toMatchObject({ text: "Đi thôi", lines: ["Đi thôi"] });
    expect(s.text_boxes[0]?.text).toBe("Câu 0");
  });

  it("diffs regions against a new AI result and applies one region, keeping user geometry", () => {
    const cur = run(doc(2), moveBox("t0", 300, 400));
    const ai: PageState = structuredClone(doc(2));
    ai.regions[0] = { ...region("r0"), translation: "AI mới" };
    ai.regions.push(region("r5", "Vùng mới"));
    ai.text_boxes.push(box("t5", "r5", "Vùng mới"));
    ai.regions.splice(1, 1);
    const diff = diffRegions(cur, ai);
    expect(diff.map((d) => [d.id, d.kind])).toEqual([
      ["r0", "changed"],
      ["r5", "added"],
      ["r1", "removed"],
    ]);
    let s = run(cur, applyRegionTranslation(ai, "r0", layout));
    expect(s.regions[0]?.translation).toBe("AI mới");
    expect(s.text_boxes[0]).toMatchObject({ x: 300, y: 400, text: "AI mới" });
    s = run(s, applyRegionTranslation(ai, "r5", layout));
    expect(s.regions.map((r) => r.id)).toContain("r5");
    expect(s.text_boxes.map((b) => b.id)).toContain("t5");
  });

  it("resetToAI replaces the whole state", () => {
    const ai = doc(1);
    expect(run(run(doc(3), moveBox("t0", 1, 1)), resetToAI(ai))).toEqual(ai);
  });

  it("inserts an OCR region with fresh ids and a fitted box", () => {
    const r = {
      ...region("r-user", "Chữ ngoài bóng"),
      polarity: "light_on_dark" as const,
      bbox: [0, 0, 120, 60] as [number, number, number, number],
    };
    const s = run(doc(0), insertOcrRegion(r, { region: "r-new", box: "t-new" }, "F", layout));
    expect(s.regions[0]?.id).toBe("r-new");
    const box = s.text_boxes[0];
    expect(box).toMatchObject({ id: "t-new", region_id: "r-new", text: "Chữ ngoài bóng", fill: "#ffffff" });
    expect(box?.lines.length).toBeGreaterThan(0);
    expect(box?.stroke).toEqual(contrastStroke("#ffffff", box?.font_size ?? 0, r.kind));
    expect(box?.stroke?.color).toBe("#000000");
    expect(contrastStroke("#ff0000", 20).color).toBe("#ffffff");
    expect(contrastStroke("#ffee00", 20).color).toBe("#000000");
    expect(contrastStroke("#fff", 20).color).toBe("#000000");
    const drawn = newTextBox("x", { x: 0, y: 0, w: 1, h: 1 }, "F", null);
    expect(drawn.w).toBe(8);
    expect(drawn.stroke).toEqual({ color: "#ffffff", width: 2.2 });
  });

  it("setStyleMany styles several boxes in one change; refreshRegionFromOcr keeps ids and box geometry", () => {
    const s0 = doc(2);
    const s1 = run(s0, setStyleMany(["t0", "t1"], { align: "left", fill: "#ff0000" }, layout));
    expect(s1.text_boxes.map((b) => [b.align, b.fill])).toEqual([
      ["left", "#ff0000"],
      ["left", "#ff0000"],
    ]);
    const ocr = { ...region("r-user", "Mới"), source_text: "새", flags: ["low_conf" as const] };
    const s2 = run(s0, refreshRegionFromOcr("r0", ocr, layout));
    expect(s2.regions[0]).toMatchObject({ id: "r0", source_text: "새", translation: "Mới", flags: ["low_conf"] });
    expect(s2.text_boxes[0]).toMatchObject({ id: "t0", x: 10, text: "Mới", lines: ["Mới"] });
    expect(s2.regions[1]).toEqual(s0.regions[1]);
  });
});
