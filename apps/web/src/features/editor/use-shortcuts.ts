/**
 * 1 listener keydown/keyup cho màn chương (chỉ gắn khi màn chương mount → Ctrl/Cmd+S, Ctrl/Cmd+F không chặn
 * trình duyệt ở màn khác): sự kiện → `resolveKey` → `run(action)`. Phím đã có hành động thì chặn mặc định trình
 * duyệt, trừ khi `run` trả `false` (không làm gì → để trình duyệt xử lý, VD Ctrl+F khi chưa có tab Tìm). `blocked()`
 * (VD đang mở drawer) tắt mọi phím trừ Ctrl/Cmd+S và nhả `O`; rời tab khi đang giữ `O` cũng coi là nhả.
 */
import { useEffect, useRef } from "react";
import { type KeyContext, resolveKey, type ShortcutAction } from "./shortcuts.ts";

const FIELD = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

export function useShortcuts(opts: {
  run(action: ShortcutAction): boolean | undefined;
  context(): KeyContext;
  blocked(): boolean;
}) {
  const ref = useRef(opts);
  ref.current = opts;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const t = e.target;
      const action = resolveKey(
        {
          type: e.type === "keyup" ? "keyup" : "keydown",
          key: e.key,
          code: e.code,
          mod: e.ctrlKey || e.metaKey,
          shift: e.shiftKey,
          alt: e.altKey,
          repeat: e.repeat,
          inField: t instanceof Element && !!t.closest(FIELD),
        },
        ref.current.context(),
      );
      if (!action) return;
      // Enter trên nút/link = bấm nút đó, không phải sửa chữ box.
      if (action.type === "editText" && t instanceof Element && t.closest("button, a, summary")) return;
      if (action.type === "holdOriginalEnd") return void ref.current.run(action);
      if (action.type !== "save" && ref.current.blocked()) return;
      if (ref.current.run(action) !== false) e.preventDefault();
    };
    const onBlur = () => ref.current.run({ type: "holdOriginalEnd" });
    addEventListener("keydown", on);
    addEventListener("keyup", on);
    addEventListener("blur", onBlur);
    return () => {
      removeEventListener("keydown", on);
      removeEventListener("keyup", on);
      removeEventListener("blur", onBlur);
    };
  }, []);
}
