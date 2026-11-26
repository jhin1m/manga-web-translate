/**
 * Registry ngôn ngữ giao diện. Thêm locale = 1 file `messages/<code>.json` (đủ key + placeholder như `vi.json`, test
 * parity kiểm) + 1 dòng trong `LOCALES` + mã đó trong `UI_LOCALES` của `@mtl/shared` (test bắt hai danh sách khớp, API
 * chỉ nhận mã có trong đó). Không cần nâng worker: payload job chỉ kiểm dạng mã. `vi` là bản gốc: đóng gói sẵn và là fallback cho key thiếu; locale khác chỉ tải
 * (`import()`, tách chunk) khi được chọn.
 */
import vi from "./messages/vi.json";

/** Mọi key dịch, lấy từ bản gốc → gõ sai key là lỗi typecheck. */
export type MessageKey = keyof typeof vi;
/** Bảng chuỗi của một locale; key thiếu thì `t()` lấy bản gốc. */
export type Messages = Readonly<Partial<Record<MessageKey, string>>>;

export type LocaleDef = { code: string; native: string; load: () => Promise<Messages> };

/** `native`: tên ngôn ngữ viết bằng chính ngôn ngữ đó — hiện nguyên văn ở mọi giao diện. */
export const LOCALES = [
  { code: "vi", native: "Tiếng Việt", load: () => Promise.resolve(vi) },
  { code: "en", native: "English", load: () => import("./messages/en.json").then((m) => m.default) },
] as const satisfies readonly LocaleDef[];

export type Locale = (typeof LOCALES)[number]["code"];

/** Bản gốc + fallback key thiếu; cũng là ngôn ngữ khi không có trình duyệt (unit test chạy trên Node). */
export const BASE_LOCALE: Locale = "vi";
/** Trình duyệt không khớp ngôn ngữ nào trong registry → dùng ngôn ngữ này. */
export const DEFAULT_FOREIGN_LOCALE: Locale = "en";
export const BASE_MESSAGES: Readonly<Record<MessageKey, string>> = vi;

export const LOCALE_CODES: readonly Locale[] = LOCALES.map((l) => l.code);

export const isLocale = (v: unknown): v is Locale => LOCALE_CODES.some((c) => c === v);

/** Tải bảng chuỗi của `code`; lỗi mạng khi tải chunk → Promise bị từ chối (người gọi quyết cách báo). */
export function loadMessages(code: Locale): Promise<Messages> {
  const def = LOCALES.find((l) => l.code === code);
  return def ? def.load() : Promise.resolve(BASE_MESSAGES);
}
