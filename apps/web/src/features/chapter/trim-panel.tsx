/**
 * Panel Cắt mép (rail trái, chương nháp): cho ảnh gốc đang xem — "Ảnh n/N", ô số Trên / Dưới (px ảnh thật, cùng số với
 * 2 thanh kéo trên canvas), Lưu / Huỷ, "Bỏ cắt" khi ảnh đã cắt. Enter trong ô = Lưu, Esc = Huỷ (ô nhập tự giữ phím,
 * viewer không giành). Ảnh đã xoá không cắt được.
 */
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { SKIP_LABEL, type SourceItem, trimLabel } from "./source-rail-model.ts";
import { parseTrimInput, type TrimEdges } from "./source-trim-model.ts";

/**
 * Ô số px: giữ chữ đang gõ riêng với giá trị đã kẹp. Chữ không phải số nguyên không âm bị bỏ qua (ô giữ chữ cũ); ô
 * trống là trạng thái đang gõ — không đổi mép, rời ô (hoặc Lưu) thì ô quay về giá trị hợp lệ gần nhất. Thanh kéo hay
 * kẹp đổi `value` thì ô theo ngay.
 */
function PxField(props: { label: string; value: number; disabled: boolean; onChange(v: number): void }) {
  const [text, setText] = useState(String(props.value));
  const prev = useRef(props.value);
  useEffect(() => {
    const moved = prev.current !== props.value;
    prev.current = props.value;
    const typed = parseTrimInput(text);
    if (typed !== props.value && (moved || typed !== null)) setText(String(props.value));
  }, [props.value, text]);
  return (
    <label className="cw-trim-field">
      <span>{props.label}</span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        disabled={props.disabled}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw.trim() === "") return setText(raw);
          const v = parseTrimInput(raw);
          if (v === null) return;
          setText(raw);
          props.onChange(v);
        }}
        onBlur={() => setText(String(props.value))}
      />
      <span className="muted">px</span>
    </label>
  );
}

export function TrimPanel(props: {
  item: SourceItem | undefined;
  index: number;
  total: number;
  edges: TrimEdges;
  /** Chiều cao ảnh thật (px); null = ảnh chưa tải xong. */
  height: number | null;
  onChange(edge: "top" | "bottom", value: number): void;
  onSave(): void;
  onCancel(): void;
  /** Bỏ cắt ảnh đã lưu. */
  onClear(): void;
}) {
  const { item, edges, height } = props;
  if (!item) return <p className="cw-trim-panel muted">Chưa có ảnh.</p>;
  const position = `Ảnh ${props.index + 1}/${props.total}`;
  if (item.skip)
    return (
      <div className="cw-trim-panel">
        <strong>{position}</strong>
        <p className="muted">Ảnh đã xoá</p>
        <p className="muted small">{SKIP_LABEL[item.skip]} — khôi phục ảnh để cắt mép.</p>
      </div>
    );
  const ready = height !== null;
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") props.onCancel();
    else if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      if (ready) props.onSave();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: chỉ bắt Enter / Esc nổi lên từ ô số và nút bên trong
    <div className="cw-trim-panel" onKeyDown={onKeyDown}>
      <div className="cw-trim-title">
        <strong aria-live="polite">{position}</strong>
        {item.trim?.by === "credit" && <span className="small muted">{trimLabel(item.trim)}</span>}
      </div>
      <PxField label="Trên" value={edges.top} disabled={!ready} onChange={(v) => props.onChange("top", v)} />
      <PxField label="Dưới" value={edges.bottom} disabled={!ready} onChange={(v) => props.onChange("bottom", v)} />
      <p className="muted small">Kéo 2 thanh trên ảnh hoặc gõ số</p>
      <div className="cw-trim-actions">
        <button type="button" className="btn btn-primary" disabled={!ready} onClick={props.onSave} title="Lưu (Enter)">
          Lưu
        </button>
        <button type="button" className="btn btn-ghost" onClick={props.onCancel} title="Huỷ (Esc)">
          Huỷ
        </button>
      </div>
      {item.trim && (
        <button type="button" className="btn btn-ghost cw-trim-clear" onClick={props.onClear}>
          Bỏ cắt
        </button>
      )}
    </div>
  );
}
