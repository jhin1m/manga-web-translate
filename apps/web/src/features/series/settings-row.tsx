/**
 * Hàng trong thẻ nhóm của modal Cài đặt dịch (cùng lớp `.set-row` với trang Cài đặt): nhãn (+ chip, ⓘ) bên trái, ô bên
 * phải; `stack` = nhãn trên, ô dưới cho ô chữ dài / bảng. Giải thích nằm trong ⓘ thay vì dòng chữ dưới nhãn.
 */
import type { ReactNode } from "react";
import { InfoTip } from "../../app/info-tip.tsx";

export function SettingsRow(props: {
  label: ReactNode;
  htmlFor?: string;
  tag?: ReactNode;
  tip?: ReactNode;
  tipLabel?: string;
  stack?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="set-row" data-stack={props.stack || undefined}>
      <div className="set-row-label">
        {props.htmlFor ? <label htmlFor={props.htmlFor}>{props.label}</label> : <span>{props.label}</span>}
        {props.tag}
        {props.tip && <InfoTip label={props.tipLabel ?? "Giải thích"}>{props.tip}</InfoTip>}
      </div>
      <div className="set-row-control">{props.children}</div>
    </div>
  );
}
