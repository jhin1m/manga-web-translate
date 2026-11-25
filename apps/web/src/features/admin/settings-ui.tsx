/**
 * Khung chung của trang Cài đặt: tiêu đề mục + mô tả, nhóm (tiêu đề nhỏ + thẻ), hàng trong thẻ (nhãn + giải thích bên
 * trái, ô điều khiển bên phải). Màn hẹp: hàng xếp dọc.
 */
import type { ReactNode } from "react";

export function SectionHead(props: { title: string; desc?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="set-head">
      <div className="set-head-text">
        <h2>{props.title}</h2>
        {props.desc && <p className="set-desc">{props.desc}</p>}
      </div>
      {props.aside && <div className="set-head-aside">{props.aside}</div>}
    </header>
  );
}

/** Một nhóm có tiêu đề nhỏ + mô tả + thẻ chứa các hàng. */
export function SetGroup(props: { title: string; desc?: ReactNode; children: ReactNode; label?: string }) {
  return (
    <section className="set-group" aria-label={props.label ?? props.title}>
      <h3>{props.title}</h3>
      {props.desc && <p className="set-desc">{props.desc}</p>}
      <div className="set-card">{props.children}</div>
    </section>
  );
}

/**
 * Hàng: `htmlFor` nối nhãn với ô; `desc` gắn vào ô qua `aria-describedby={descId(htmlFor)}` để tên truy cập của ô chỉ
 * là nhãn.
 */
export const descId = (id: string) => `${id}-desc`;
export function SetRow(props: { label: ReactNode; htmlFor?: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-label">
        {props.htmlFor ? <label htmlFor={props.htmlFor}>{props.label}</label> : <span>{props.label}</span>}
        {props.desc && (
          <p className="set-desc" id={props.htmlFor ? descId(props.htmlFor) : undefined}>
            {props.desc}
          </p>
        )}
      </div>
      <div className="set-row-control">{props.children}</div>
    </div>
  );
}

/** Trạng thái tự lưu ở đầu mục. */
export function SaveStatus(props: { pending: boolean; error: string | null; saved: boolean }) {
  if (props.pending)
    return (
      <span className="muted small" role="status">
        Đang lưu…
      </span>
    );
  if (props.error)
    return (
      <span className="error small" role="alert">
        {props.error}
      </span>
    );
  if (props.saved)
    return (
      <span className="set-saved small" role="status">
        Đã lưu
      </span>
    );
  return null;
}
