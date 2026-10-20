/** Hộp thoại modal dựa trên <dialog> native (focus trap + Esc do trình duyệt lo). Chỉ mount khi đang mở. */
import { type ReactNode, useEffect, useRef } from "react";
import type { LockState } from "./use-chapter-lock.ts";

export function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} aria-label={title}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button type="button" onClick={() => ref.current?.close()}>
          Đóng
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

/** Trạng thái khoá chương trong hộp thoại ghi nội dung. */
export function LockBanner({ state, onRetry }: { state: LockState; onRetry(): void }) {
  if (state.status === "held") return null;
  if (state.status === "acquiring") return <p className="notice info">Đang lấy khoá chương…</p>;
  if (state.status === "denied")
    return (
      <p className="notice">
        <strong>{state.holderName ?? "Thành viên khác"}</strong> đang giữ khoá chương — chỉ xem trước được, chưa áp
        dụng.{" "}
        <button type="button" className="btn-ghost" onClick={onRetry}>
          Thử lại
        </button>
      </p>
    );
  return (
    <p className="notice danger">
      Không lấy được khoá chương: {state.message}{" "}
      <button type="button" className="btn-ghost" onClick={onRetry}>
        Thử lại
      </button>
    </p>
  );
}
