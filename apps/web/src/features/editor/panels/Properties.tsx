/**
 * Thuộc tính box đang chọn: chữ, font, cỡ (tắt khi auto-fit), giãn dòng, lề, căn lề, màu, viền ngoài, ẩn.
 * Thay đổi liên tục cùng trường (gõ số, kéo màu) gộp 1 bước undo qua key `style:<field>:<id>`.
 */
import type { TextBox } from "@mtl/shared";
import { type BoxStyle, deleteBox, editText, setStyle } from "../actions.ts";
import { editorStore, useEditor } from "../store.ts";
import { TextField } from "./TextField.tsx";

const ALIGN: { id: TextBox["align"]; label: string }[] = [
  { id: "left", label: "Trái" },
  { id: "center", label: "Giữa" },
  { id: "right", label: "Phải" },
];

const num = (v: string, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

export function Properties({ fonts }: { fonts: string[] }) {
  const box = useEditor((s) => s.doc?.text_boxes.find((b) => b.id === s.selection));
  const readOnly = useEditor((s) => !!s.readOnly);
  if (!box) return <p className="muted small ed-pad">Chọn một khung chữ để sửa thuộc tính. Double-click để sửa chữ.</p>;

  const st = editorStore.getState();
  const style = (field: keyof BoxStyle, patch: BoxStyle) => {
    if (st.layout) st.apply(setStyle(box.id, patch, st.layout), `style:${field}:${box.id}`);
  };

  return (
    <fieldset className="ed-props" disabled={readOnly}>
      <label htmlFor="ed-text">Chữ</label>
      <TextField
        id="ed-text"
        key={box.id}
        value={box.text}
        rows={3}
        onValue={(v) => st.layout && st.apply(editText(box.id, v, st.layout), `text:${box.id}`)}
      />
      <label htmlFor="ed-font">Font</label>
      <select
        id="ed-font"
        value={box.font_family}
        onChange={(e) => style("font_family", { font_family: e.target.value })}
      >
        {!fonts.includes(box.font_family) && <option value={box.font_family}>{box.font_family} (thiếu)</option>}
        {fonts.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <div className="ed-row">
        <div>
          <label htmlFor="ed-size">Cỡ (px)</label>
          <input
            id="ed-size"
            type="number"
            min={6}
            max={200}
            step={1}
            value={box.font_size}
            disabled={box.auto_fit}
            onChange={(e) => {
              const v = num(e.target.value, 6, 200);
              if (v !== null) style("font_size", { font_size: v });
            }}
          />
        </div>
        <div>
          <label htmlFor="ed-lh">Giãn dòng</label>
          <input
            id="ed-lh"
            type="number"
            min={0.6}
            max={3}
            step={0.05}
            value={box.line_height}
            onChange={(e) => {
              const v = num(e.target.value, 0.6, 3);
              if (v !== null) style("line_height", { line_height: v });
            }}
          />
        </div>
        <div>
          <label htmlFor="ed-pad">Lề</label>
          <input
            id="ed-pad"
            type="number"
            min={0}
            max={100}
            value={box.pad}
            onChange={(e) => {
              const v = num(e.target.value, 0, 100);
              if (v !== null) style("pad", { pad: v });
            }}
          />
        </div>
      </div>
      <label className="ed-check">
        <input
          type="checkbox"
          checked={box.auto_fit}
          onChange={(e) => style("auto_fit", { auto_fit: e.target.checked })}
        />
        Tự khớp cỡ chữ vào khung
      </label>
      <span className="label">Căn lề</span>
      <div className="ed-seg">
        {ALIGN.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-pressed={box.align === a.id}
            className={box.align === a.id ? "on" : undefined}
            onClick={() => style("align", { align: a.id })}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="ed-row">
        <div>
          <label htmlFor="ed-fill">Màu chữ</label>
          <input
            id="ed-fill"
            type="color"
            value={box.fill.slice(0, 7)}
            onChange={(e) => style("fill", { fill: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="ed-stroke-c">Màu viền</label>
          <input
            id="ed-stroke-c"
            type="color"
            value={(box.stroke?.color ?? "#ffffff").slice(0, 7)}
            onChange={(e) => style("stroke", { stroke: { color: e.target.value, width: box.stroke?.width ?? 2 } })}
          />
        </div>
        <div>
          <label htmlFor="ed-stroke-w">Viền ngoài (px)</label>
          <input
            id="ed-stroke-w"
            type="number"
            min={0}
            max={20}
            step={0.5}
            value={box.stroke?.width ?? 0}
            onChange={(e) => {
              const w = num(e.target.value, 0, 20);
              if (w === null) return;
              style("stroke", { stroke: w > 0 ? { color: box.stroke?.color ?? "#ffffff", width: w } : null });
            }}
          />
        </div>
      </div>
      <label className="ed-check">
        <input type="checkbox" checked={box.hidden} onChange={(e) => style("hidden", { hidden: e.target.checked })} />
        Ẩn khi xuất
      </label>
      <div className="ed-actions">
        <button type="button" className="btn-danger" onClick={() => st.apply(deleteBox(box.id))}>
          Xoá khung
        </button>
      </div>
    </fieldset>
  );
}
