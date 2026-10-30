/**
 * Drawer phải (420px) dùng ở màn chương + app shell: scrim xám (không blur), `role="dialog"` + `aria-labelledby`,
 * Esc / bấm scrim / nút Đóng = đóng. Mở → focus vào drawer, Tab vòng trong drawer; đóng → trả focus về phần tử
 * đang focus lúc mở (VD nút "Export"). Chỉ mount khi đang mở. `variant="modal"`: cùng hành vi nhưng là hộp giữa màn
 * (rộng hơn — cài đặt dịch / glossary của series).
 */
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";
import "./drawer.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex="0"]';

export function Drawer(props: {
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  variant?: "drawer" | "modal";
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    // Capture: Esc đóng drawer trước mọi phím tắt khác của màn.
    addEventListener("keydown", onKey, true);
    return () => {
      removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const trap = (e: ReactKeyboardEvent) => {
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <div className="drawer-scrim" aria-hidden="true" onClick={props.onClose} />
      <div
        ref={ref}
        className={props.variant === "modal" ? "drawer modal" : "drawer"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trap}
      >
        <div className="drawer-head">
          <h2 id={titleId}>{props.title}</h2>
          <button type="button" className="btn-ghost" onClick={props.onClose}>
            Đóng
          </button>
        </div>
        <div className="drawer-body">{props.children}</div>
        {props.footer && <div className="drawer-foot">{props.footer}</div>}
      </div>
    </>
  );
}
