/**
 * Kiểu chữ của box đang chọn (chữ sửa ở ô "Bản dịch" của panel Chọn), chia 2 phần:
 * - `BasicStyle`: font, cỡ (tắt khi tự khớp), tự khớp cỡ chữ vào khung — luôn hiện.
 * - `AdvancedStyle`: giãn dòng, lề, căn lề, màu chữ, màu viền, viền ngoài, ẩn khi xuất — trong "Kiểu chữ nâng cao".
 * Thay đổi liên tục cùng trường (gõ số, kéo màu) gộp 1 bước undo qua key `style:<field>:<id>`.
 */
import type { Region, TextBox, TextStyle } from "@mtl/shared";
import { type ReactNode, useState } from "react";
import { type BoxStyle, setStyle, setTextStyle } from "../actions.ts";
import { fontPreview } from "../fonts.ts";
import { editorStore, useEditor } from "../store.ts";
import { committedNumber, liveNumber } from "./number-input.ts";

const ALIGN: { id: TextBox["align"]; label: string }[] = [
  { id: "left", label: "Trái" },
  { id: "center", label: "Giữa" },
  { id: "right", label: "Phải" },
];

const VALIGN: { id: NonNullable<TextBox["valign"]>; label: string; aria: string }[] = [
  { id: "top", label: "Trên", aria: "Căn dọc: sát mép trên" },
  { id: "middle", label: "Giữa", aria: "Căn dọc: giữa khung" },
];

/**
 * Ô số giữ chuỗi đang gõ: chỉ áp số hợp lệ trong khoảng ngay khi gõ; rời ô / Enter kẹp trong khoảng (rỗng → giữ giá trị
 * cũ) rồi hiện lại giá trị của box. Đặt `key` theo box để đổi khối là bỏ chuỗi dở.
 */
function NumberInput(props: {
  id: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Đúng `min` chỉ áp khi rời ô / Enter (xem `liveNumber`). */
  commitMin?: boolean;
  disabled?: boolean;
  title?: string;
  onValue(v: number): void;
}) {
  const { min, max, onValue } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = committedNumber(draft, min, max);
    if (v !== null && v !== props.value) onValue(v);
    setDraft(null);
  };
  return (
    <input
      id={props.id}
      type="number"
      min={min}
      max={max}
      step={props.step}
      value={draft ?? props.value}
      disabled={props.disabled}
      title={props.title}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = liveNumber(e.target.value, min, max, props.commitMin);
        if (v !== null) onValue(v);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

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

const STYLE_LABEL: Record<TextStyle, string> = { normal: "Thường", thought: "Suy nghĩ", note: "Ghi chú" };

/** Loại chữ có slot font ở series + hàm chọn font cho (loại chữ, kind vùng) — cùng quy tắc worker. */
export type TextStyleConfig = {
  slots: Partial<Record<Exclude<TextStyle, "normal">, string>>;
  fontFor(style: TextStyle, kind: Region["kind"]): string;
};

/** Select "Loại chữ" chỉ hiện khi series đã chọn ít nhất 1 slot thought/note. */
export const hasTextStyleSlot = (slots: TextStyleConfig["slots"]) => Boolean(slots.thought || slots.note);

/** Option của select "Loại chữ": Thường + loại có slot (+ loại hiện tại của vùng nếu thiếu slot, để không mất giá trị). */
export function textStyleOptions(slots: TextStyleConfig["slots"], current: TextStyle): TextStyle[] {
  const options: TextStyle[] = ["normal", ...(["thought", "note"] as const).filter((k) => slots[k])];
  if (!options.includes(current)) options.push(current);
  return options;
}

/** Select "Loại chữ": chỉ khi box có vùng và series có ít nhất 1 slot thought/note. Đổi = 1 bước undo (region + font). */
function TextStyleSelect({ box, config }: { box: TextBox; config: TextStyleConfig }) {
  const region = useEditor((s) => s.doc?.regions.find((r) => r.id === box.region_id));
  if (!region) return null;
  const current: TextStyle = region.style ?? "normal";
  const options = textStyleOptions(config.slots, current);
  return (
    <div>
      <label htmlFor="ed-text-style">Loại chữ</label>
      <select
        id="ed-text-style"
        value={current}
        onChange={(e) => {
          const next = e.target.value as TextStyle;
          const st = editorStore.getState();
          if (st.layout) st.apply(setTextStyle(box.id, next, config.fontFor(next, region.kind), st.layout));
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {STYLE_LABEL[o]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 2 nhóm option font tuỳ chỉnh: hệ thống trước, của bạn sau; nhóm rỗng không hiện. */
function CustomFontGroups({ fonts }: { fonts: { id: string; name: string; system?: boolean }[] }) {
  return (
    <>
      {[
        { label: "Font hệ thống", list: fonts.filter((f) => f.system) },
        { label: "Font của bạn", list: fonts.filter((f) => !f.system) },
      ].map(
        ({ label, list }) =>
          list.length > 0 && (
            <optgroup key={label} label={label}>
              {list.map((f) => (
                <option key={f.id} value={f.id} style={fontPreview(f.id)}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          ),
      )}
    </>
  );
}

/** `fonts`: font gói sẵn; `customFonts`: font hệ thống + font của bạn (2 nhóm riêng trong select). Mỗi option vẽ bằng chính font đó. */
export function BasicStyle({
  fonts,
  customFonts = [],
  knows = () => false,
  textStyle,
}: {
  fonts: string[];
  customFonts?: { id: string; name: string; system?: boolean }[];
  /** Font có thật nhưng không nằm trong `fonts` (đã lọc theo ngôn ngữ đích) → ghi "không hợp ngôn ngữ", không phải "thiếu". */
  knows?: (id: string) => boolean;
  /** Có slot font Suy nghĩ/Ghi chú ở series → hiện select "Loại chữ" dưới ô Font. */
  textStyle?: TextStyleConfig;
}) {
  const { box, readOnly, style } = useBoxStyle();
  if (!box) return null;
  const listed = fonts.includes(box.font_family) || customFonts.some((f) => f.id === box.font_family);
  return (
    <fieldset className="ed-props" disabled={readOnly}>
      <div className="ed-row">
        <div>
          <label htmlFor="ed-font">Font</label>
          <select
            id="ed-font"
            className="font-select"
            style={fontPreview(box.font_family)}
            value={box.font_family}
            onChange={(e) => style("font_family", { font_family: e.target.value })}
          >
            {!listed && (
              <option value={box.font_family}>
                {box.font_family} ({knows(box.font_family) ? "thiếu chữ ngôn ngữ này" : "thiếu"})
              </option>
            )}
            {fonts.map((f) => (
              <option key={f} value={f} style={fontPreview(f)}>
                {f}
              </option>
            ))}
            <CustomFontGroups fonts={customFonts} />
          </select>
          {textStyle && hasTextStyleSlot(textStyle.slots) && <TextStyleSelect box={box} config={textStyle} />}
        </div>
        <div>
          <label htmlFor="ed-size">Cỡ chữ (px)</label>
          <NumberInput
            key={box.id}
            id="ed-size"
            min={6}
            max={200}
            step={1}
            value={box.font_size}
            disabled={box.auto_fit}
            title={box.auto_fit ? "Đang tự khớp cỡ chữ vào khung" : undefined}
            onValue={(v) => style("font_size", { font_size: v })}
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
          <NumberInput
            key={box.id}
            id="ed-lh"
            min={0.6}
            max={3}
            step={0.05}
            value={box.line_height}
            onValue={(v) => style("line_height", { line_height: v })}
          />
        </div>
        <div>
          <label htmlFor="ed-pad">Lề</label>
          <NumberInput
            key={box.id}
            id="ed-pad"
            min={0}
            max={100}
            value={box.pad}
            onValue={(v) => style("pad", { pad: v })}
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
      <span className="label">Căn dọc</span>
      <div className="ed-seg">
        {VALIGN.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-label={a.aria}
            aria-pressed={(box.valign ?? "top") === a.id}
            className={(box.valign ?? "top") === a.id ? "on" : undefined}
            onClick={() => style("valign", { valign: a.id })}
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
          <NumberInput
            key={box.id}
            id="ed-stroke-w"
            min={0}
            max={20}
            step={0.5}
            commitMin
            value={box.stroke?.width ?? 0}
            onValue={(w) =>
              style("stroke", { stroke: w > 0 ? { color: box.stroke?.color ?? "#ffffff", width: w } : null })
            }
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
