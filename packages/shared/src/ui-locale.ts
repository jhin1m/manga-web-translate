/**
 * Ngôn ngữ giao diện web. Web đồng bộ lựa chọn lên `user.ui_locale`; job dịch / hiệu đính mang nó trong payload
 * (`ui_lang`) để AI viết ghi chú cho người đọc (`style_note`, lý do hiệu đính) đúng ngôn ngữ đó. Registry web
 * (`apps/web/src/i18n/locales.ts`) phải khớp danh sách này — test web kiểm.
 */
export const UI_LOCALES = ["vi", "en"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

/** Chưa đồng bộ / mã lạ / job xếp hàng trước khi có trường → tiếng Việt như trước. */
export const DEFAULT_UI_LOCALE: UiLocale = "vi";

export const isUiLocale = (v: unknown): v is UiLocale => UI_LOCALES.some((c) => c === v);
