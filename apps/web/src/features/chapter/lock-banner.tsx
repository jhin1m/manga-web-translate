import type { LockState } from "./use-chapter-lock.ts";

/** Trạng thái khoá chương ở tab ghi nội dung (Tìm/Thay, Áp glossary): chỉ hiện khi chưa giữ được khoá. */
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
