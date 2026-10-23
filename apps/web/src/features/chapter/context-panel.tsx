/**
 * Panel ngữ cảnh cạnh rail công cụ (288px; 560px cho Bản dịch / Tìm): đầu panel 44px (tiêu đề + nút thu) + thân cuộn.
 * Thu panel chỉ ẩn (`hidden`) — giữ nội dung đã mount (kết quả xem trước Tìm/Thay). `focus` = yêu cầu focus 1 phần tử
 * trong panel (Ctrl/Cmd+F → ô tìm); `seq` đổi = yêu cầu mới, chạy sau khi panel đã hiện.
 */
import { type ReactNode, useEffect, useRef } from "react";
import { CloseIcon } from "./tool-icons.tsx";

export type FocusRequest = { seq: number; selector: string };

export function ContextPanel(props: {
  title: string;
  open: boolean;
  wide: boolean;
  onClose(): void;
  focus?: FocusRequest | null;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
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
    <aside ref={ref} className="cw-panel" data-wide={props.wide || undefined} aria-label={props.title} hidden={!open}>
      <div className="cw-panel-head">
        <h2>{props.title}</h2>
        <button type="button" className="icon-btn" aria-label="Thu panel" title="Thu panel" onClick={props.onClose}>
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="cw-panel-body">{props.children}</div>
    </aside>
  );
}
