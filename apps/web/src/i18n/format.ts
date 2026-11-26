/**
 * Định dạng số / ngày / so sánh chuỗi theo ngôn ngữ giao diện đang dùng. Hàm thuần (đọc store lúc gọi) — trong React
 * dùng kèm `useT()` để component vẽ lại khi đổi ngôn ngữ. Formatter được cache theo locale + tuỳ chọn.
 */
import { i18nStore } from "./i18n-store.ts";

const currentLocale = () => i18nStore.getState().locale;
const cacheKey = (locale: string, opts: object | undefined) => (opts ? `${locale}|${JSON.stringify(opts)}` : locale);

function cached<T>(cache: Map<string, T>, opts: object | undefined, make: (locale: string) => T): T {
  const locale = currentLocale();
  const key = cacheKey(locale, opts);
  let value = cache.get(key);
  if (!value) {
    value = make(locale);
    cache.set(key, value);
  }
  return value;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const collators = new Map<string, Intl.Collator>();

/** `1234.5` → "1.234,5" (vi) / "1,234.5" (en). */
export const fmtNumber = (n: number, opts?: Intl.NumberFormatOptions): string =>
  cached(numberFormats, opts, (l) => new Intl.NumberFormat(l, opts)).format(n);

/** Ngày từ `Date`, ISO hoặc epoch ms; giá trị không phải ngày hợp lệ → chuỗi rỗng (không ném lỗi giữa lúc render). */
export function fmtDate(value: Date | string | number, opts?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return cached(dateFormats, opts, (l) => new Intl.DateTimeFormat(l, opts)).format(date);
}

const NATURAL: Intl.CollatorOptions = { numeric: true, sensitivity: "base" };

/** So sánh chuỗi để sắp xếp hiển thị; mặc định "tự nhiên" (số so như số, không phân biệt hoa thường / dấu). */
export const collator = (opts: Intl.CollatorOptions = NATURAL): Intl.Collator =>
  cached(collators, opts === NATURAL ? undefined : opts, (l) => new Intl.Collator(l, opts));
