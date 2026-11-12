/**
 * Panel Cắt mép (rail trái, chương nháp): cho ảnh gốc đang xem — "Ảnh n/N", ô số Trên / Dưới (px ảnh thật, cùng số với
 * 2 thanh kéo trên canvas), Lưu / Huỷ, "Bỏ cắt" khi ảnh đã cắt. Enter trong ô = Lưu, Esc = Huỷ (ô nhập tự giữ phím,
 * viewer không giành). Ảnh đã xoá không cắt được.
 */
import { MIN_TRIM_KEEP_PX } from "@mtl/shared";
import { type KeyboardEvent, useEffect, useState } from "react";
import { SKIP_LABEL, type SourceItem, trimLabel } from "./source-rail-model.ts";
import { parseTrimInput, type TrimEdges } from "./source-trim-model.ts";

/** Ô số px: giữ chữ đang gõ (trống / dở dang) riêng với giá trị đã kẹp; thanh kéo hay kẹp đổi `value` thì ô theo ngay. */
function PxField(props: { label: string; value: number; max: number; disabled: boolean; onChange(v: number): void }) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => {
    if (parseTrimInput(text) !== props.value) setText(String(props.value));
  }, [props.value, text]);
  return (
    <label className="cw-trim-field">
      <span>{props.label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={props.max}
        step={1}
        value={text}
        disabled={props.disabled}
        onChange={(e) => {
          const v = parseTrimInput(e.target.value);
          if (v === null) return;
          setText(e.target.value);
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
  const max = Math.max(0, (height ?? 0) - MIN_TRIM_KEEP_PX);
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
      <PxField label="Trên" value={edges.top} max={max} disabled={!ready} onChange={(v) => props.onChange("top", v)} />
      <PxField
        label="Dưới"
        value={edges.bottom}
        max={max}
        disabled={!ready}
        onChange={(v) => props.onChange("bottom", v)}
      />
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
