/**
 * Chọn loại truyện khi tạo series: Manga / Manhwa / Manhua chỉ quyết định định dạng trang (COMIC_KIND_SETTINGS), nguồn
 * mặc định tiếng Anh. Raw Hàn / Nhật / Trung đổi ngôn ngữ ở Cài đặt series.
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
