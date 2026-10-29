/** Nhãn tiếng Việt cho ngôn ngữ + định dạng truyện của series (danh sách mã từ @mtl/shared). */
import { type ComicKind, LANG_NAMES, type PageFormat, type SourceLang, type TargetLang } from "@mtl/shared/series-lang";

export {
  COMIC_KIND_SETTINGS,
  COMIC_KINDS,
  type ComicKind,
  HONORIFIC_EXAMPLES,
  LANG_NAMES,
  PAGE_FORMATS,
  SOURCE_LANGS,
  TARGET_LANGS,
} from "@mtl/shared/series-lang";
export type { PageFormat, SourceLang, TargetLang };

/** Tên ngắn cho header ("Hàn → Việt"). */
export const langShort = (code: string) => LANG_NAMES[code as SourceLang]?.replace(/^Tiếng /, "") ?? code;

type Pair = { source_lang: string; target_lang: string };
/** "Hàn → Việt". */
export const pairLabel = (p: Pair) => `${langShort(p.source_lang)} → ${langShort(p.target_lang)}`;

/**
 * Cảnh báo ở form Cài đặt khi đổi ngôn ngữ mà series có glossary riêng (entry riêng không gắn cặp nên vẫn áp
 * sau khi đổi). Không đổi cặp, hoặc chưa biết / 0 từ → null.
 */
export function langChangeWarning(saved: Pair, form: Pair, ownTerms: number | undefined): string | null {
  if (!ownTerms || (saved.source_lang === form.source_lang && saved.target_lang === form.target_lang)) return null;
  return (
    `Glossary riêng của series có ${ownTerms} từ viết cho ${pairLabel(saved)} — kiểm lại sau khi đổi ngôn ngữ. ` +
    `Glossary chung sẽ chuyển sang cặp ${pairLabel(form)}.`
  );
}

/** Nhãn loại truyện ở form tạo series: tên + gợi ý ngôn ngữ / cách xử lý. */
export const COMIC_KIND_LABELS: Record<ComicKind, { name: string; hint: string }> = {
  manga: { name: "Manga", hint: "Nhật · từng trang, dịch thẳng" },
  manhwa: { name: "Manhwa", hint: "Hàn · cuộn dọc" },
  manhua: { name: "Manhua", hint: "Trung · cuộn dọc" },
};

export const PAGE_FORMAT_LABELS: Record<PageFormat, string> = {
  strip: "Cuộn dọc (manhwa/manhua)",
  pages: "Từng trang (manga)",
};

/** Placeholder ô "Xưng / gọi" theo ngôn ngữ đích. */
export const addressPlaceholder = (tgt: TargetLang) =>
  tgt === "vi" ? "anh/em" : tgt === "en" ? "Boss / kid" : "cách gọi";
