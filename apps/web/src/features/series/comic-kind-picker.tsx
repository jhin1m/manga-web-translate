/**
 * Chọn loại truyện khi tạo series (thay cho chọn ngôn ngữ gốc): Manga / Manhwa / Manhua → server nhận ngôn ngữ gốc
 * + định dạng tương ứng (COMIC_KIND_SETTINGS). Ngôn ngữ khác (VD tiếng Anh) đổi sau ở Cài đặt series.
 */
import { COMIC_KIND_LABELS, COMIC_KINDS, type ComicKind } from "./lang-labels.ts";

export function ComicKindPicker(props: { value: ComicKind; onChange: (v: ComicKind) => void }) {
  return (
    <select aria-label="Loại truyện" value={props.value} onChange={(e) => props.onChange(e.target.value as ComicKind)}>
      {COMIC_KINDS.map((k) => (
        <option key={k} value={k}>
          {COMIC_KIND_LABELS[k]}
        </option>
      ))}
    </select>
  );
}
