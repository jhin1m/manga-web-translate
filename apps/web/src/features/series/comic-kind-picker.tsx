/**
 * Chọn loại truyện khi tạo series (thay cho chọn ngôn ngữ gốc): Manga / Manhwa / Manhua → server nhận ngôn ngữ gốc
 * + định dạng tương ứng (COMIC_KIND_SETTINGS). Ngôn ngữ khác (VD tiếng Anh) đổi sau ở Cài đặt series.
 */
import { useId } from "react";
import { COMIC_KIND_LABELS, COMIC_KINDS, type ComicKind } from "./lang-labels.ts";
import "./comic-kind-picker.css";

export function ComicKindPicker(props: { value: ComicKind; onChange: (v: ComicKind) => void }) {
  const name = useId(); // 2 picker cùng trang (form tạo series + dòng xác nhận thả ảnh) không chung nhóm radio
  return (
    <div className="comic-kind" role="radiogroup" aria-label="Loại truyện">
      {COMIC_KINDS.map((k) => (
        <label key={k} className="comic-kind-opt" data-checked={props.value === k || undefined}>
          <input type="radio" name={name} value={k} checked={props.value === k} onChange={() => props.onChange(k)} />
          <b>{COMIC_KIND_LABELS[k].name}</b>
          <span>{COMIC_KIND_LABELS[k].hint}</span>
        </label>
      ))}
    </div>
  );
}
