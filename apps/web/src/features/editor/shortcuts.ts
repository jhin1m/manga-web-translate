/**
 * Bảng phím tắt màn chương (thuần — test không DOM): sự kiện phím → hành động, `use-shortcuts.ts` thực thi.
 * Phím đơn tắt khi focus trong ô nhập (input/textarea/select/contenteditable); chỉ Ctrl/Cmd+S và Ctrl/Cmd+F chạy
 * cả trong ô. `O` giữ = tạm xem ảnh gốc (OCR vùng dùng `R`).
 */
import { type MessageKey, t } from "../../i18n/t.ts";
import type { Tool } from "./store.ts";

export type KeyInput = {
  type: "keydown" | "keyup";
  key: string;
  /** `KeyboardEvent.code` — nhả `O` khớp theo phím vật lý (Alt/Cmd giữa chừng đổi `key`). */
  code?: string;
  /** Ctrl hoặc Cmd. */
  mod: boolean;
  shift: boolean;
  alt: boolean;
  repeat: boolean;
  /** Focus đang ở ô nhập. */
  inField: boolean;
};

export type KeyContext = {
  /** Có box đang chọn trên canvas (Enter/Delete chỉ chạy khi có). */
  selection: boolean;
};

export type ShortcutAction =
  | { type: "tool"; tool: Tool }
  | { type: "holdOriginalStart" }
  | { type: "holdOriginalEnd" }
  | { type: "toggleOriginal" }
  | { type: "page"; dir: -1 | 1 }
  | { type: "block"; dir: -1 | 1 }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "save" }
  | { type: "find" }
  | { type: "editText" }
  | { type: "deleteBox" }
  | { type: "escape" }
  | { type: "help" };

const TOOLS: Record<string, Tool> = { v: "select", t: "text", b: "brush", e: "eraser", r: "ocr" };
const PAGE: Record<string, -1 | 1> = { a: -1, d: 1, pageup: -1, pagedown: 1, arrowleft: -1, arrowright: 1 };

/** Một dòng bảng phím: chữ đọc theo ngôn ngữ lúc dùng (getter), không lúc import. `keys` là chuỗi phím thô hoặc key dịch. */
const row = (keys: string | { label: MessageKey }, action: MessageKey): { keys: string; action: string } => ({
  get keys() {
    return typeof keys === "string" ? keys : t(keys.label);
  },
  get action() {
    return t(action);
  },
});

/** Bảng tra phím trong UI (`?`). */
export const SHORTCUT_HELP: { keys: string; action: string }[] = [
  row("V · T · B · E · R", "editor.shortcuts.tools"),
  row({ label: "editor.shortcuts.holdOriginalKeys" }, "editor.shortcuts.holdOriginal"),
  row("\\", "editor.shortcuts.toggleOriginal"),
  row("A / D · PageUp / PageDown · ← / →", "editor.shortcuts.page"),
  row("Alt+↑ / Alt+↓", "editor.shortcuts.block"),
  row("Ctrl/Cmd+Z · Ctrl/Cmd+Shift+Z · Ctrl+Y", "editor.shortcuts.undoRedo"),
  row("Ctrl/Cmd+S", "editor.shortcuts.save"),
  row("Ctrl/Cmd+F", "editor.shortcuts.find"),
  row("Enter · Delete", "editor.shortcuts.editDelete"),
  row("Esc", "editor.shortcuts.escape"),
  row({ label: "editor.shortcuts.panKeys" }, "editor.shortcuts.pan"),
  row({ label: "editor.shortcuts.zoomKeys" }, "editor.shortcuts.zoom"),
  row({ label: "editor.shortcuts.wheelFlipKeys" }, "editor.shortcuts.wheelFlip"),
  row("?", "editor.shortcuts.help"),
];

export function resolveKey(e: KeyInput, ctx: KeyContext): ShortcutAction | null {
  const k = e.key.toLowerCase();
  if (e.type === "keyup") return k === "o" || e.code === "KeyO" ? { type: "holdOriginalEnd" } : null;
  if (e.mod && !e.alt) {
    if (k === "s") return { type: "save" };
    if (k === "f") return { type: "find" };
    if (e.inField) return null;
    if (k === "z") return { type: e.shift ? "redo" : "undo" };
    if (k === "y") return { type: "redo" };
    return null;
  }
  if (e.inField || e.mod) return null;
  if (e.alt) {
    if (k === "arrowup") return { type: "block", dir: -1 };
    if (k === "arrowdown") return { type: "block", dir: 1 };
    return null;
  }
  if (k === "o") return e.repeat ? null : { type: "holdOriginalStart" };
  if (e.repeat && k !== "arrowleft" && k !== "arrowright" && k !== "pageup" && k !== "pagedown") return null;
  const tool = TOOLS[k];
  if (tool && !e.shift) return { type: "tool", tool };
  const dir = PAGE[k];
  if (dir) return { type: "page", dir };
  if (e.key === "\\") return { type: "toggleOriginal" };
  if (e.key === "?") return { type: "help" };
  if (k === "escape") return { type: "escape" };
  if (!ctx.selection) return null;
  if (k === "enter") return { type: "editText" };
  if (k === "delete" || k === "backspace") return { type: "deleteBox" };
  return null;
}
