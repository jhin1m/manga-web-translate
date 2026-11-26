/**
 * Ngôn ngữ giao diện đang dùng (zustand vanilla: đọc được từ hàm thuần, React subscribe qua `useT()`).
 * Mặc định là bản gốc (`vi`) cho tới khi `initI18n()` chạy — unit test không gọi nó nên luôn ở tiếng Việt.
 * Thứ tự chọn lúc mở app: lựa chọn đã lưu (`mtl.locale`) → ngôn ngữ trình duyệt khớp registry → `en`.
 */
import { createStore } from "zustand/vanilla";
import {
  BASE_LOCALE,
  BASE_MESSAGES,
  DEFAULT_FOREIGN_LOCALE,
  isLocale,
  LOCALE_CODES,
  type Locale,
  loadMessages,
  type Messages,
} from "./locales.ts";

export const LOCALE_STORAGE_KEY = "mtl.locale";

/** `locale` thường thuộc `LOCALES`; để `string` để test áp được registry tạm qua `applyLocale` mà không sửa `t.ts`. */
export type I18nState = { locale: string; messages: Messages };

export const i18nStore = createStore<I18nState>(() => ({ locale: BASE_LOCALE, messages: BASE_MESSAGES }));

/** Đầu vào của `detectLocale`: lựa chọn đã lưu + danh sách ngôn ngữ trình duyệt (`undefined` = không có trình duyệt). */
export type DetectEnv = { stored?: string | null; languages?: readonly string[] | undefined };
/** `base`: khi không có trình duyệt; `foreign`: khi trình duyệt không khớp mã nào. */
export type LocaleRegistry<C extends string> = { codes: readonly C[]; base: C; foreign: C };

const REGISTRY: LocaleRegistry<Locale> = { codes: LOCALE_CODES, base: BASE_LOCALE, foreign: DEFAULT_FOREIGN_LOCALE };

/** Khớp theo thứ tự ưu tiên của trình duyệt: đúng mã (`pt-br`) trước, rồi tiền tố (`vi-VN` → `vi`). */
function matchLanguage<C extends string>(languages: readonly string[], codes: readonly C[]): C | undefined {
  for (const raw of languages) {
    const tag = raw.toLowerCase();
    const primary = tag.split("-")[0];
    const hit = codes.find((c) => c.toLowerCase() === tag) ?? codes.find((c) => c.toLowerCase() === primary);
    if (hit) return hit;
  }
  return undefined;
}

export function detectLocale(env?: DetectEnv): Locale;
export function detectLocale<C extends string>(env: DetectEnv, registry: LocaleRegistry<C>): C;
export function detectLocale(env: DetectEnv = browserEnv(), registry: LocaleRegistry<string> = REGISTRY): string {
  const stored = registry.codes.find((c) => c === env.stored);
  if (stored) return stored;
  if (!env.languages?.length) return registry.base;
  return matchLanguage(env.languages, registry.codes) ?? registry.foreign;
}

/** Đặt locale + bảng chuỗi và `<html lang>` (không tải, không lưu). Locale ngoài registry chỉ dùng trong test. */
export function applyLocale(locale: string, messages: Messages): void {
  i18nStore.setState({ locale, messages });
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

let latest = 0;

/** Tải rồi áp; lượt chọn cũ tải xong sau lượt mới thì bỏ. Trả `true` nếu đã áp. */
async function switchLocale(code: Locale): Promise<boolean> {
  const mine = ++latest;
  const messages = await loadMessages(code);
  if (mine !== latest) return false;
  applyLocale(code, messages);
  return true;
}

/** Người dùng chọn ngôn ngữ: áp ngay (không reload) và nhớ cho lần sau. Tải chunk lỗi → Promise bị từ chối. */
export async function setLocale(code: Locale): Promise<void> {
  if (await switchLocale(code)) writeStored(code);
}

/** Thời gian tối đa chờ bảng chuỗi lúc mở app; quá hạn thì vẽ bằng bản gốc thay vì để trắng trang. */
export const I18N_INIT_TIMEOUT_MS = 5000;

/**
 * Gọi 1 lần trước khi render để không nháy chữ Việt khi locale là `en`. Không lưu locale tự nhận (đổi ngôn ngữ trình
 * duyệt sau này vẫn có tác dụng). Không bao giờ từ chối: tải lỗi hoặc treo quá `timeoutMs` → giữ bản gốc để app vẫn
 * mở được (bảng chuỗi tải xong muộn bị bỏ, không đổi chữ giữa chừng; người dùng vẫn đổi được ở Cài đặt).
 */
export async function initI18n(timeoutMs = I18N_INIT_TIMEOUT_MS): Promise<void> {
  const code = detectLocale();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"expired">((resolve) => {
    timer = setTimeout(() => resolve("expired"), timeoutMs);
  });
  try {
    if ((await Promise.race([switchLocale(code), expired])) === "expired") {
      latest++;
      console.warn(`i18n: locale "${code}" took over ${timeoutMs} ms to load, using "${BASE_LOCALE}"`);
      applyLocale(BASE_LOCALE, BASE_MESSAGES);
    }
  } catch (err) {
    console.warn(`i18n: cannot load locale "${code}", using "${BASE_LOCALE}"`, err);
    applyLocale(BASE_LOCALE, BASE_MESSAGES);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Đồng bộ ngôn ngữ giao diện lên server (job AI viết ghi chú theo nó, kể cả job tự xếp hàng không qua trình duyệt):
 * gửi ngay nếu locale đang dùng khác `serverLocale` (một lần lúc mở app), rồi mỗi lần đổi ngôn ngữ. Gửi lỗi chỉ ghi
 * cảnh báo — giao diện không phụ thuộc server; lần đổi sau gửi lại. Trả hàm ngừng theo dõi.
 */
export function syncLocaleToServer(
  serverLocale: string | null | undefined,
  push: (code: Locale) => Promise<unknown>,
): () => void {
  let onServer = serverLocale ?? null;
  const send = (code: string) => {
    if (!isLocale(code) || code === onServer) return;
    const before = onServer;
    onServer = code;
    push(code).catch((err: unknown) => {
      if (onServer === code) onServer = before;
      console.warn(`i18n: cannot save locale "${code}" on the server`, err);
    });
  };
  send(i18nStore.getState().locale);
  return i18nStore.subscribe((s, prev) => {
    if (s.locale !== prev.locale) send(s.locale);
  });
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function readStored(): string | null {
  try {
    return safeStorage()?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStored(code: Locale) {
  try {
    safeStorage()?.setItem(LOCALE_STORAGE_KEY, code);
  } catch {
    // Không ghi được (chế độ riêng tư, đầy bộ nhớ) → chỉ giữ trong phiên này.
  }
}

/** Node (vitest) cũng có `navigator` (en-US) → chỉ coi là trình duyệt khi có `document`. */
function browserEnv(): DetectEnv {
  if (typeof document === "undefined" || typeof navigator === "undefined") return {};
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return { stored: readStored(), languages };
}
