/**
 * Cờ ở góc thumbnail (cột trang / cột ảnh gốc): một ký hiệu nhỏ, nhưng tên truy cập + tooltip luôn là câu đầy đủ
 * (trạng thái và lý do) — màu chỉ là phần phụ, không phải kênh duy nhất.
 */
export type ThumbFlagTone = "danger" | "warn" | "busy" | "ok" | "idle";

export function ThumbFlagBadge(props: { glyph: string; tone: ThumbFlagTone; text: string }) {
  return (
    <span className="cw-thumb-flag" data-tone={props.tone} role="img" aria-label={props.text} title={props.text}>
      {props.glyph}
    </span>
  );
}
