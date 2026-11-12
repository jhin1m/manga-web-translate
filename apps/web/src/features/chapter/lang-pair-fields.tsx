/**
 * Hai ô chọn ngôn ngữ gốc / đích của series, nằm trong popover của chip ngôn ngữ (chapter-meta-popover.tsx; lưu bằng PATCH
 * series, giống form Cài đặt series). Ngôn ngữ gốc sai (VD chọn Manhwa nhưng ảnh là bản scan tiếng Anh) làm bước quét
 * chữ bỏ trống khối có chữ — đổi ở đây rồi quét lại vùng đó / dịch lại.
 */
import { LANG_NAMES, SOURCE_LANGS, type SourceLang, TARGET_LANGS, type TargetLang } from "../series/lang-labels.ts";

export function LangPairFields(props: {
  src: SourceLang;
  tgt: TargetLang;
  onSrc(l: SourceLang): void;
  onTgt(l: TargetLang): void;
  /** Vừa mở popover → focus ô ngôn ngữ gốc. */
  autoFocus?: boolean;
}) {
  return (
    <>
      <label>
        Ngôn ngữ gốc (chữ trên ảnh)
        <select
          value={props.src}
          // biome-ignore lint/a11y/noAutofocus: popover chỉ để đổi ngôn ngữ → chọn ngay
          autoFocus={props.autoFocus}
          onChange={(e) => props.onSrc(e.target.value as SourceLang)}
        >
          {SOURCE_LANGS.map((l) => (
            <option key={l} value={l}>
              {LANG_NAMES[l]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Dịch sang
        <select value={props.tgt} onChange={(e) => props.onTgt(e.target.value as TargetLang)}>
          {TARGET_LANGS.map((l) => (
            <option key={l} value={l}>
              {LANG_NAMES[l]}
            </option>
          ))}
        </select>
      </label>
      <span className="small muted">
        Áp cho cả series từ lần chạy sau. Trang đã dịch không tự chạy lại: khối bị trống thì dùng công cụ Quét chữ kéo
        khung quanh chữ; đổi ngôn ngữ đích thì "Dịch lại cả chương".
      </span>
    </>
  );
}
