/**
 * Panel ngữ cảnh cạnh rail công cụ: đầu panel 44px (tiêu đề + thao tác riêng của panel + nút thu) + thân cuộn. Panel
 * khối (272px) đè lên canvas (`overlay`: không chiếm cột nên canvas giữ nguyên bề ngang khi đóng/mở); Bản dịch / Tìm /
 * Hiệu đính (560px) vẫn chiếm cột bên cạnh canvas.
 * Thu panel chỉ ẩn (`hidden`) — giữ nội dung đã mount (kết quả xem trước Tìm/Thay). `focus` = yêu cầu focus 1 phần tử
 * trong panel (Ctrl/Cmd+F → ô tìm); `seq` đổi = yêu cầu mới, chạy sau khi panel đã hiện.
 */
import { type ReactNode, type Ref, useEffect, useRef } from "react";
import { CloseIcon } from "./tool-icons.tsx";

export type FocusRequest = { seq: number; selector: string };

export function ContextPanel(props: {
  /** Tên truy cập của `<aside>`. */
  title: string;
  /** Chữ ở đầu panel (mặc định `title`). */
  heading?: string;
  /** Nút riêng của panel, đặt trước nút thu. */
  actions?: ReactNode;
  open: boolean;
  wide: boolean;
  /** Đè lên canvas thay vì chiếm cột. */
  overlay?: boolean;
  /** Phần tử `<aside>` — đo bề ngang panel che canvas. */
  elRef?: Ref<HTMLElement>;
  onClose(): void;
  focus?: FocusRequest | null;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const done = useRef(0);
  const { focus, open } = props;
  // Không có dependency: phần tử cần focus có thể vừa mount ở lần render sau (panel Tìm mở lần đầu).
  useEffect(() => {
    if (!focus || !open || done.current === focus.seq) return;
    const el = ref.current?.querySelector<HTMLElement>(focus.selector);
    if (!el || el.offsetParent === null) return;
    done.current = focus.seq;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
  });
  return (
    <aside
      ref={(el) => {
        ref.current = el;
        if (typeof props.elRef === "function") props.elRef(el);
        else if (props.elRef) props.elRef.current = el;
      }}
      className="cw-panel"
      data-wide={props.wide || undefined}
      data-overlay={props.overlay || undefined}
      aria-label={props.title}
      hidden={!props.open}
    >
      <div className="cw-panel-head">
        <h2>{props.heading ?? props.title}</h2>
        {props.actions}
        <button type="button" className="icon-btn" aria-label="Thu panel" title="Thu panel" onClick={props.onClose}>
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="cw-panel-body">{props.children}</div>
    </aside>
  );
}
