/**
 * Menu nổi dùng chung (chuột phải thumbnail trang / ảnh gốc, menu "⋯" thanh trên): `div role="menu"` vị trí fixed tại
 * `at` (kẹp trong viewport), focus mục đầu bật được, ↑/↓/Home/End di chuyển, Esc / Tab / bấm ngoài / cuộn / đổi cỡ cửa
 * sổ → đóng. Esc và chọn mục trả focus về `anchor` (phần tử mở menu).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckIcon } from "./tool-icons.tsx";

export type MenuItem = {
  label: string;
  run(): void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  /** Có giá trị → mục bật/tắt (`menuitemcheckbox`). */
  checked?: boolean;
};

export type MenuAt = { x: number; y: number };

/** Điểm mở menu bằng bàn phím: góc dưới trái phần tử. */
export const menuAtElement = (el: HTMLElement): MenuAt => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 4 };
};

/** Phím mở menu ngữ cảnh khi phần tử đang focus: Shift+F10 hoặc phím Menu. */
export const isMenuKey = (e: { key: string; shiftKey: boolean }) =>
  e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");

export function ContextMenu(props: {
  at: MenuAt;
  items: MenuItem[];
  label: string;
  anchor?: HTMLElement | null;
  /** Neo theo cạnh phải của `at` (menu "⋯" sát mép phải thanh trên). */
  alignRight?: boolean;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const { onClose, anchor } = props;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Đo menu rồi kẹp trong viewport (lề 8px) trước khi vẽ.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const x = props.alignRight ? props.at.x - width : props.at.x;
    setPos({
      left: Math.max(8, Math.min(x, innerWidth - width - 8)),
      top: Math.max(8, Math.min(props.at.y, innerHeight - height - 8)),
    });
  }, [props.at, props.alignRight]);

  // Focus mục đầu sau khi menu đã đặt chỗ (lúc đo còn `visibility: hidden` → chưa focus được).
  const placed = pos !== null;
  useEffect(() => {
    if (placed) ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [placed]);

  useEffect(() => {
    const close = () => closeRef.current();
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    // Cuộn bên trong menu không đóng; cuộn cột trang / trang thì đóng (menu không còn khớp vị trí).
    const scroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    addEventListener("scroll", scroll, true);
    addEventListener("resize", close);
    addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      removeEventListener("scroll", scroll, true);
      removeEventListener("resize", close);
      removeEventListener("blur", close);
    };
  }, []);

  const move = (dir: 1 | -1 | "first" | "last") => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = dir === "first" ? 0 : dir === "last" ? items.length - 1 : (i + dir + items.length) % items.length;
    items[next]?.focus();
  };
  // Có mục bật/tắt → mọi mục chừa cột dấu ✓ để chữ thẳng hàng.
  const checkable = props.items.some((it) => it.checked !== undefined);
  const closeAndReturn = () => {
    onClose();
    if (anchor?.isConnected) anchor.focus();
  };

  return (
    <div
      ref={ref}
      className="cw-ctx-menu"
      role="menu"
      aria-label={props.label}
      style={pos ? { left: pos.left, top: pos.top } : { left: props.at.x, top: props.at.y, visibility: "hidden" }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") move(1);
        else if (e.key === "ArrowUp") move(-1);
        else if (e.key === "Home") move("first");
        else if (e.key === "End") move("last");
        else if (e.key === "Escape") closeAndReturn();
        else if (e.key === "Tab") onClose();
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {props.items.map((it) => (
        <button
          key={it.label}
          type="button"
          {...(it.checked === undefined
            ? { role: "menuitem" }
            : { role: "menuitemcheckbox", "aria-checked": it.checked })}
          data-danger={it.danger || undefined}
          disabled={it.disabled}
          title={it.title}
          onClick={() => {
            closeAndReturn();
            it.run();
          }}
        >
          {checkable && <span className="cw-ctx-check">{it.checked && <CheckIcon size={14} />}</span>}
          {it.label}
        </button>
      ))}
    </div>
  );
}
