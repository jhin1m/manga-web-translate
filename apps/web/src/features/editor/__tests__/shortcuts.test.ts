import { describe, expect, it } from "vitest";
import { type KeyInput, resolveKey } from "../shortcuts.ts";

const down = (key: string, o: Partial<KeyInput> = {}): KeyInput => ({
  type: "keydown",
  key,
  mod: false,
  shift: false,
  alt: false,
  repeat: false,
  inField: false,
  ...o,
});
const sel = { selection: true };
const none = { selection: false };

describe("resolveKey", () => {
  it("maps every row of the shortcut table", () => {
    const cases: [KeyInput, unknown][] = [
      [down("v"), { type: "tool", tool: "select" }],
      [down("T"), { type: "tool", tool: "text" }],
      [down("b"), { type: "tool", tool: "brush" }],
      [down("e"), { type: "tool", tool: "eraser" }],
      [down("r"), { type: "tool", tool: "ocr" }],
      [down("o"), { type: "holdOriginalStart" }],
      [down("\\"), { type: "toggleOriginal" }],
      [down("a"), { type: "page", dir: -1 }],
      [down("d"), { type: "page", dir: 1 }],
      [down("PageUp"), { type: "page", dir: -1 }],
      [down("PageDown"), { type: "page", dir: 1 }],
      [down("ArrowLeft"), { type: "page", dir: -1 }],
      [down("ArrowRight"), { type: "page", dir: 1 }],
      [down("ArrowUp", { alt: true }), { type: "block", dir: -1 }],
      [down("ArrowDown", { alt: true }), { type: "block", dir: 1 }],
      [down("z", { mod: true }), { type: "undo" }],
      [down("Z", { mod: true, shift: true }), { type: "redo" }],
      [down("y", { mod: true }), { type: "redo" }],
      [down("s", { mod: true }), { type: "save" }],
      [down("f", { mod: true }), { type: "find" }],
      [down("Enter"), { type: "editText" }],
      [down("Delete"), { type: "deleteBox" }],
      [down("Backspace"), { type: "deleteBox" }],
      [down("Escape"), { type: "escape" }],
      [down("?", { shift: true }), { type: "help" }],
    ];
    for (const [input, want] of cases) expect(resolveKey(input, sel), input.key).toEqual(want);
  });

  it("single keys do nothing while typing; Ctrl/Cmd+S and Ctrl/Cmd+F still work", () => {
    expect(resolveKey(down("v", { inField: true }), sel)).toBeNull();
    expect(resolveKey(down("o", { inField: true }), sel)).toBeNull();
    expect(resolveKey(down("Delete", { inField: true }), sel)).toBeNull();
    expect(resolveKey(down("ArrowDown", { alt: true, inField: true }), sel)).toBeNull();
    // Ô nhập tự hoàn tác chữ của nó.
    expect(resolveKey(down("z", { mod: true, inField: true }), sel)).toBeNull();
    expect(resolveKey(down("s", { mod: true, inField: true }), sel)).toEqual({ type: "save" });
    expect(resolveKey(down("f", { mod: true, inField: true }), sel)).toEqual({ type: "find" });
  });

  it("holding O: auto-repeat is ignored, keyup ends the hold", () => {
    expect(resolveKey(down("o", { repeat: true }), none)).toBeNull();
    expect(resolveKey({ ...down("o"), type: "keyup" }, none)).toEqual({ type: "holdOriginalEnd" });
    expect(resolveKey({ ...down("O", { inField: true }), type: "keyup" }, none)).toEqual({ type: "holdOriginalEnd" });
    expect(resolveKey({ ...down("ø", { alt: true }), code: "KeyO", type: "keyup" }, none)).toEqual({
      type: "holdOriginalEnd",
    });
    expect(resolveKey({ ...down("v"), type: "keyup" }, none)).toBeNull();
  });

  it("Enter/Delete need a selected box; other modifiers pass through to the browser", () => {
    expect(resolveKey(down("Enter"), none)).toBeNull();
    expect(resolveKey(down("Delete"), none)).toBeNull();
    expect(resolveKey(down("c", { mod: true }), sel)).toBeNull();
    expect(resolveKey(down("v", { mod: true }), sel)).toBeNull();
    expect(resolveKey(down("v", { alt: true }), sel)).toBeNull();
    expect(resolveKey(down("v", { repeat: true }), sel)).toBeNull();
    expect(resolveKey(down("ArrowRight", { repeat: true }), sel)).toEqual({ type: "page", dir: 1 });
  });

  it("leaves undo/redo to the browser while typing in a field (e.g. the find/replace inputs)", () => {
    expect(resolveKey(down("z", { mod: true, inField: true }), sel)).toBeNull();
    expect(resolveKey(down("z", { mod: true, shift: true, inField: true }), sel)).toBeNull();
    expect(resolveKey(down("y", { mod: true, inField: true }), sel)).toBeNull();
  });
});
