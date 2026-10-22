/** Nhãn tiếng Việt cho ngôn ngữ + định dạng truyện của series (danh sách mã từ @mtl/shared). */
import {
  LANG_NAMES,
  type PageFormat,
  type SourceLang,
  type TargetLang,
  TESTED_SOURCE_LANGS,
} from "@mtl/shared/series-lang";

export {
  HONORIFIC_EXAMPLES,
  LANG_NAMES,
  PAGE_FORMATS,
  SOURCE_LANGS,
  TARGET_LANGS,
} from "@mtl/shared/series-lang";
export type { PageFormat, SourceLang, TargetLang };

/** Tên ngắn cho header ("Hàn → Việt"). */
export const langShort = (code: string) => LANG_NAMES[code as SourceLang]?.replace(/^Tiếng /, "") ?? code;

export const PAGE_FORMAT_LABELS: Record<PageFormat, string> = {
  strip: "Cuộn dọc (manhwa/manhua)",
  pages: "Từng trang (manga)",
};

/** Placeholder ô "Xưng / gọi" theo ngôn ngữ đích. */
export const addressPlaceholder = (tgt: TargetLang) =>
  tgt === "vi" ? "anh/em" : tgt === "en" ? "Boss / kid" : "cách gọi";

export const isTestedSource = (src: SourceLang) => TESTED_SOURCE_LANGS.includes(src);
