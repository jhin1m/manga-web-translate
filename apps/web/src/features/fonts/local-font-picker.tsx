/**
 * Chọn font cài trong máy để thêm: ô tìm + danh sách có ô tích, mỗi dòng xem trước bằng chính font đó. Font đã thêm
 * (trùng tên) không tích được; số font tích được ≤ `remaining` (chỗ còn trống của font riêng).
 * Chỉ vẽ tối đa SHOWN dòng một lúc (máy có thể có cả nghìn font) — gõ để tìm font còn lại.
 */
import { useMemo, useState } from "react";
import { filterFonts, type LocalFont } from "./local-fonts.ts";

const SHOWN = 300;

export function LocalFontPicker(props: {
  fonts: LocalFont[];
  /** Tên font đã thêm (khớp `fullName`). */
  added: ReadonlySet<string>;
  remaining: number;
  busy: boolean;
  onAdd(list: LocalFont[]): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const matches = useMemo(() => filterFonts(props.fonts, query), [props.fonts, query]);
  const full = picked.size >= props.remaining;
  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <section className="set-card local-picker" aria-label="Font trong máy">
      <div className="local-picker-head">
        <input
          type="search"
          aria-label="Tìm font trong máy"
          placeholder={`Tìm trong ${props.fonts.length} font`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="muted small">
          {picked.size > 0 ? `Đã chọn ${picked.size}` : "Tích font muốn thêm"}
          {Number.isFinite(props.remaining) && ` · còn ${props.remaining} chỗ`}
        </span>
      </div>
      {props.remaining === 0 && (
        <p className="warn-text small">Đã đủ số font riêng tối đa. Xoá bớt font không dùng để thêm font mới.</p>
      )}
      <ul className="local-picker-list">
        {matches.slice(0, SHOWN).map((f) => {
          const done = props.added.has(f.fullName);
          const on = picked.has(f.postscriptName);
          return (
            <li key={f.postscriptName} data-done={done || undefined}>
              <label>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={done || props.busy || (!on && full)}
                  onChange={(e) => toggle(f.postscriptName, e.target.checked)}
                />
                <span className="local-picker-name">
                  {f.fullName}
                  {done && <span className="font-tag">Đã thêm</span>}
                </span>
                <span className="local-picker-preview" style={{ fontFamily: `"${f.family}"` }} aria-hidden="true">
                  Xin chào! Tiếng Việt
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {matches.length === 0 && <p className="muted small">Không có font nào khớp.</p>}
      {matches.length > SHOWN && (
        <p className="muted small">
          Đang hiện {SHOWN} / {matches.length} font — gõ tên để tìm font còn lại.
        </p>
      )}
      <div className="row">
        <button
          type="button"
          className="btn-primary"
          disabled={picked.size === 0 || props.busy}
          onClick={() => props.onAdd(props.fonts.filter((f) => picked.has(f.postscriptName)))}
        >
          {props.busy ? "Đang thêm…" : `Thêm ${picked.size || ""} font`.replace("  ", " ")}
        </button>
        <button type="button" onClick={props.onClose} disabled={props.busy}>
          Đóng
        </button>
      </div>
    </section>
  );
}
