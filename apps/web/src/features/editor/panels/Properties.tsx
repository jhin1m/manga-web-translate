/**
 * Kiểu chữ của box đang chọn (chữ sửa ở ô "Bản dịch" của panel Chọn), chia 2 phần:
 * - `BasicStyle`: font, cỡ (tắt khi tự khớp), tự khớp cỡ chữ vào khung — luôn hiện.
 * - `AdvancedStyle`: giãn dòng, lề, căn lề, màu chữ, màu viền, viền ngoài, ẩn khi xuất — trong "Kiểu chữ nâng cao".
 * Thay đổi liên tục cùng trường (gõ số, kéo màu) gộp 1 bước undo qua key `style:<field>:<id>`.
 */
import type { TextBox } from "@mtl/shared";
import type { ReactNode } from "react";
import { type BoxStyle, setStyle } from "../actions.ts";
import { editorStore, useEditor } from "../store.ts";

const ALIGN: { id: TextBox["align"]; label: string }[] = [
  { id: "left", label: "Trái" },
  { id: "center", label: "Giữa" },
  { id: "right", label: "Phải" },
];

const num = (v: string, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

/** Box đang chọn + hàm đổi 1 trường kiểu (1 bước undo mỗi chuỗi thay đổi cùng trường). */
function useBoxStyle() {
  const box = useEditor((s) => s.doc?.text_boxes.find((b) => b.id === s.selection));
  const readOnly = useEditor((s) => !!s.readOnly);
  const style = (field: keyof BoxStyle, patch: BoxStyle) => {
    const st = editorStore.getState();
    if (box && st.layout) st.apply(setStyle(box.id, patch, st.layout), `style:${field}:${box.id}`);
  };
  return { box, readOnly, style };
}

/** `fonts`: font gói sẵn; `customFonts`: font của nhóm (nhóm riêng trong select). */
export function BasicStyle({
  fonts,
  customFonts = [],
}: {
  fonts: string[];
  customFonts?: { id: string; name: string }[];
}) {
  const { box, readOnly, style } = useBoxStyle();
  if (!box) return null;
  return (
    <fieldset className="ed-props" disabled={readOnly}>
      <div className="ed-row">
        <div>
          <label htmlFor="ed-font">Font</label>
          <select
            id="ed-font"
            value={box.font_family}
            onChange={(e) => style("font_family", { font_family: e.target.value })}
          >
            {!fonts.includes(box.font_family) && !customFonts.some((f) => f.id === box.font_family) && (
              <option value={box.font_family}>{box.font_family} (thiếu)</option>
            )}
            {fonts.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
            {customFonts.length > 0 && (
              <optgroup label="Font của nhóm">
                {customFonts.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div>
          <label htmlFor="ed-size">Cỡ chữ (px)</label>
          <input
            id="ed-size"
            type="number"
            min={6}
            max={200}
            step={1}
            value={box.font_size}
            disabled={box.auto_fit}
            title={box.auto_fit ? "Đang tự khớp cỡ chữ vào khung" : undefined}
            onChange={(e) => {
              const v = num(e.target.value, 6, 200);
              if (v !== null) style("font_size", { font_size: v });
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
    </fieldset>
  );
}

/** `children`: thao tác thêm ở cuối (VD "Áp kiểu này cho khối cùng loại"). */
export function AdvancedStyle({ children }: { children?: ReactNode }) {
  const { box, readOnly, style } = useBoxStyle();
  if (!box) return null;
  return (
    <fieldset className="ed-props" disabled={readOnly}>
      <div className="ed-row">
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
      {children}
    </fieldset>
  );
}
