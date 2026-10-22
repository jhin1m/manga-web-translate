/** Ngôn ngữ + định dạng truyện của series — dùng chung API (validate), web (form) và payload job. */

export const SOURCE_LANGS = ["ko", "ja", "zh", "en"] as const;
export type SourceLang = (typeof SOURCE_LANGS)[number];

/** Đích chữ Latin: font trong worker/fonts có đủ glyph, ngắt dòng theo dấu cách. */
export const TARGET_LANGS = ["vi", "en", "id", "es", "pt", "fr"] as const;
export type TargetLang = (typeof TARGET_LANGS)[number];

/** strip = ghép slice cùng width rồi cắt theo detector (manhwa/manhua); pages = 1 file = 1 page (manga). */
export const PAGE_FORMATS = ["strip", "pages"] as const;
export type PageFormat = (typeof PAGE_FORMATS)[number];

export const LANG_NAMES: Record<SourceLang | TargetLang, string> = {
  ko: "Tiếng Hàn",
  ja: "Tiếng Nhật",
  zh: "Tiếng Trung",
  en: "Tiếng Anh",
  vi: "Tiếng Việt",
  id: "Tiếng Indonesia",
  es: "Tiếng Tây Ban Nha",
  pt: "Tiếng Bồ Đào Nha",
  fr: "Tiếng Pháp",
};

/** Ví dụ kính ngữ theo ngôn ngữ nguồn — câu chỉ dẫn gửi LLM (API) và nhãn form (web). ko giữ đúng phạm vi cũ. */
export const HONORIFIC_EXAMPLES: Record<SourceLang, string> = {
  ko: "-nim, -ssi",
  ja: "-san, -kun, -chan, -sama, senpai",
  zh: "哥, 姐, 师兄, 前辈",
  en: "Mr./Ms., Sir",
};

/** Nguồn đã kiểm định chất lượng; nguồn khác vẫn chọn được, UI chỉ ghi chú. */
export const TESTED_SOURCE_LANGS: readonly SourceLang[] = ["ko"];

export const defaultPageFormat = (src: SourceLang): PageFormat => (src === "ja" ? "pages" : "strip");

export type ReadingOrder = "ltr" | "rtl";

/** Manga Nhật dạng trang: hàng trên→dưới, trong hàng phải→trái. Còn lại giữ trên→dưới, trái→phải. */
export const readingOrder = (src: string, fmt: string): ReadingOrder =>
  src === "ja" && fmt === "pages" ? "rtl" : "ltr";
