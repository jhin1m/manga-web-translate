/** Select ngôn ngữ gốc (glossary chọn cặp ngôn ngữ). Tạo series dùng ComicKindPicker thay vì chọn ngôn ngữ. */
import { LANG_NAMES, SOURCE_LANGS, type SourceLang } from "./lang-labels.ts";

export function SourceLangSelect(props: { value: SourceLang; onChange: (v: SourceLang) => void }) {
  return (
    <select
      aria-label="Ngôn ngữ gốc"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as SourceLang)}
    >
      {SOURCE_LANGS.map((l) => (
        <option key={l} value={l}>
          {LANG_NAMES[l]}
        </option>
      ))}
    </select>
  );
}
