/** Nhãn ngôn ngữ + định dạng truyện của series theo ngôn ngữ giao diện (danh sách mã từ @mtl/shared). */
import type { ComicKind, PageFormat, SourceLang, TargetLang } from "@mtl/shared/series-lang";
import { type MessageKey, t } from "../../i18n/t.ts";

export {
  COMIC_KIND_SETTINGS,
  COMIC_KINDS,
  type ComicKind,
  defaultTargetLang,
  HONORIFIC_EXAMPLES,
  PAGE_FORMATS,
  SOURCE_LANGS,
  TARGET_LANGS,
} from "@mtl/shared/series-lang";
export type { PageFormat, SourceLang, TargetLang };

type Lang = SourceLang | TargetLang;

const LANG_KEY: Readonly<Record<Lang, { name: MessageKey; short: MessageKey }>> = {
  ko: { name: "lang.ko", short: "lang.short.ko" },
  ja: { name: "lang.ja", short: "lang.short.ja" },
  zh: { name: "lang.zh", short: "lang.short.zh" },
  en: { name: "lang.en", short: "lang.short.en" },
  vi: { name: "lang.vi", short: "lang.short.vi" },
  id: { name: "lang.id", short: "lang.short.id" },
  es: { name: "lang.es", short: "lang.short.es" },
  pt: { name: "lang.pt", short: "lang.short.pt" },
  fr: { name: "lang.fr", short: "lang.short.fr" },
};

const isLang = (code: string): code is Lang => Object.hasOwn(LANG_KEY, code);

/** Tên đầy đủ của ngôn ngữ ("Tiếng Hàn" / "Korean"); mã lạ giữ nguyên. */
export const langName = (code: string) => (isLang(code) ? t(LANG_KEY[code].name) : code);

/**
 * Tên ngôn ngữ theo mã, đọc theo ngôn ngữ giao diện lúc truy cập (getter) — giữ shape `Record<mã, tên>` cho chỗ đang
 * tra `LANG_NAMES[code]`.
 */
export const LANG_NAMES: Readonly<Record<Lang, string>> = Object.defineProperties(
  {} as Record<Lang, string>,
  Object.fromEntries(Object.keys(LANG_KEY).map((code) => [code, { enumerable: true, get: () => langName(code) }])),
);

/** Tên ngắn cho header ("Hàn → Việt"). */
export const langShort = (code: string) => (isLang(code) ? t(LANG_KEY[code].short) : code);

type Pair = { source_lang: string; target_lang: string };
/** "Hàn → Việt". */
export const pairLabel = (p: Pair) => `${langShort(p.source_lang)} → ${langShort(p.target_lang)}`;

/**
 * Cảnh báo ở Cài đặt khi đổi ngôn ngữ mà series có glossary (entry không gắn cặp nên vẫn áp sau khi đổi). Không đổi
 * cặp, hoặc chưa biết / 0 từ → null.
 */
export function langChangeWarning(before: Pair, now: Pair, terms: number | undefined): string | null {
  if (!terms || (before.source_lang === now.source_lang && before.target_lang === now.target_lang)) return null;
  return t("series.langLabels.langChangeWarning", { terms, pair: pairLabel(before) });
}

/** Nhãn loại truyện ở ô chọn khi tạo series (tên riêng, giống nhau ở mọi ngôn ngữ). */
export const COMIC_KIND_LABELS: Record<ComicKind, string> = {
  manga: "Manga",
  manhwa: "Manhwa",
  manhua: "Manhua",
};

const PAGE_FORMAT_KEY: Readonly<Record<PageFormat, MessageKey>> = {
  strip: "series.langLabels.pageFormat.strip",
  pages: "series.langLabels.pageFormat.pages",
};

export const PAGE_FORMAT_LABELS: Readonly<Record<PageFormat, string>> = {
  get strip() {
    return t(PAGE_FORMAT_KEY.strip);
  },
  get pages() {
    return t(PAGE_FORMAT_KEY.pages);
  },
};

/**
 * Placeholder ô "Xưng / gọi" theo ngôn ngữ đích: ví dụ là chữ của chính ngôn ngữ đích (dữ liệu, không dịch theo giao
 * diện); đích khác không có ví dụ → nhãn chung theo giao diện.
 */
export const addressPlaceholder = (tgt: TargetLang) =>
  tgt === "vi" ? "anh/em" : tgt === "en" ? "Boss / kid" : t("series.langLabels.addressFallback");
