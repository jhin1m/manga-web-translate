import { QUOTA_EXCEEDED } from "@mtl/shared";
import { useQuery } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/react";
import { fmtDate } from "../i18n/format.ts";
import { i18nStore } from "../i18n/i18n-store.ts";
import { BASE_LOCALE } from "../i18n/locales.ts";
import { hasMessage, type Params, t } from "../i18n/t.ts";

export const authClient = createAuthClient({ basePath: "/api/auth" });

const TAB_ID_KEY = "mtl.tab-id";
let memoryTabId: string | null = null;

/**
 * Id của tab trình duyệt (uuid, giữ qua reload trong `sessionStorage`) — gửi ở header `x-tab-id` mọi request: khoá
 * chương giữ theo từng tab (tab khác của cùng tài khoản chỉ xem). sessionStorage bị chặn → id trong bộ nhớ của trang.
 */
export function tabId(): string {
  try {
    const stored = sessionStorage.getItem(TAB_ID_KEY);
    if (stored) return stored;
    const id = crypto.randomUUID();
    sessionStorage.setItem(TAB_ID_KEY, id);
    return id;
  } catch {
    memoryTabId ??= crypto.randomUUID();
    return memoryTabId;
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Body lỗi đầy đủ (VD `rejected`, `spent_usd`) để UI hiển thị chi tiết. */
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Đường về màn đăng nhập kèm lý do khi tài khoản bị khoá giữa chừng. */
export const DISABLED_LOGIN_PATH = "/login?reason=disabled";

/** Tác động lên phiên khi API báo phiên không dùng được (tách ra để test thay được). */
export const sessionEffects = {
  refetchSession: () => authClient.$store.notify("$sessionSignal"),
  signOut: () => authClient.signOut(),
  goto: (path: string) => window.location.assign(path),
};

/**
 * Phản hồi cho phiên không còn dùng được: 401 → báo better-auth lấy lại phiên (AuthGate hiện màn đăng nhập ngay, không
 * cần reload / focus); 403 `user_disabled` (phiên sót lại sau khi khoá) → đăng xuất rồi về màn đăng nhập kèm lý do.
 */
function onSessionLost(status: number, data: Record<string, unknown>) {
  if (status === 401) sessionEffects.refetchSession();
  else if (status === 403 && data.error === "user_disabled") {
    void sessionEffects.signOut().finally(() => sessionEffects.goto(DISABLED_LOGIN_PATH));
  }
}

/** Gọi API cùng origin (body JSON, hoặc FormData cho multipart); lỗi HTTP → ApiError. 204 → undefined. */
export async function api<T>(path: string, init: Omit<RequestInit, "body"> & { body?: unknown } = {}): Promise<T> {
  const { body, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    credentials: "same-origin",
    headers: {
      "x-tab-id": tabId(),
      // FormData: trình duyệt tự đặt content-type kèm boundary.
      ...(body === undefined || body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...rest.headers,
    },
    body: body === undefined || body instanceof FormData ? (body as FormData | undefined) : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    onSessionLost(res.status, data);
    const msg = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : "";
    throw new ApiError(res.status, apiErrorText(data, msg || res.statusText), data);
  }
  return data as T;
}

/**
 * `GET /api/config` (public): chế độ chạy của server. `local_mode` = self-host 1 người dùng, không đăng nhập.
 * `version` = phiên bản app ("0.3.0" hoặc "dev"); API cũ không có.
 */
export type AppConfig = { local_mode: boolean; version?: string };

/**
 * API cũ chưa có route (web cập nhật trước API, hoặc rollback API) → bản nhiều người dùng: route lạ dưới /api trả 401
 * khi chưa đăng nhập (requireUser chạy trước 404), 404 khi đã đăng nhập. Bản local luôn có route này và nó public.
 * Chỉ lỗi mạng / 5xx (và mã khác) mới là "không biết chế độ" → màn lỗi ở AuthGate.
 */
export const fetchAppConfig = () =>
  api<AppConfig>("/api/config").catch((err: unknown) => {
    if (err instanceof ApiError && (err.status === 404 || err.status === 401)) {
      return { local_mode: false } satisfies AppConfig;
    }
    throw err;
  });

/** Không đổi trong suốt vòng đời server → cache vô hạn (đổi chế độ = restart server = tải lại trang). */
export const appConfigQuery = {
  queryKey: ["app-config"],
  queryFn: fetchAppConfig,
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: Number.POSITIVE_INFINITY,
} as const;

export const useAppConfig = () => useQuery(appConfigQuery);

/** Đang ở chế độ local? Chưa tải xong / lỗi → false (hành vi bản nhiều người dùng). */
export const useLocalMode = (): boolean => useAppConfig().data?.local_mode === true;

/** Hạn mức chi phí hôm nay (`limit_usd` null = không giới hạn). */
export type Quota = { spent_usd: number; limit_usd: number | null; resets_at: string };

/**
 * `GET /api/me`: người đang đăng nhập + quyền admin + hạn mức hôm nay + ngôn ngữ giao diện đã đồng bộ lên server
 * (`ui_locale` null = chưa từng gửi; API cũ không có trường).
 */
export type Me = {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
  quota: Quota;
  ui_locale?: string | null;
};

/** Lưu ngôn ngữ giao diện lên server — ghi chú AI của job (giọng văn, lý do hiệu đính) viết theo nó. */
export const putUiLocale = (ui_locale: string) =>
  api<{ ui_locale: string }>("/api/me/locale", { method: "PUT", body: { ui_locale } });

export const usd = (n: number) => `$${n.toFixed(2)}`;
const clock = (iso: string) => fmtDate(iso, { hour: "2-digit", minute: "2-digit" });

/** Câu báo hết hạn mức ngày (402 `quota_exceeded`). */
export const quotaText = (q: { spent_usd?: unknown; limit_usd?: unknown; resets_at?: unknown }) => {
  const params = { spent: usd(Number(q.spent_usd ?? 0)), limit: usd(Number(q.limit_usd ?? 0)) };
  return typeof q.resets_at === "string"
    ? t("errors.quotaExceededUntil", { ...params, time: clock(q.resets_at) })
    : t("errors.quotaExceeded", params);
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** `params` của lỗi API: chỉ giữ giá trị chuỗi / số (dữ liệu từ server, không tin kiểu). */
function errorParams(v: unknown): Params {
  if (!v || typeof v !== "object") return {};
  return Object.fromEntries(
    Object.entries(v).filter((kv): kv is [string, string | number] => ["string", "number"].includes(typeof kv[1])),
  );
}

const PLACEHOLDER_NAMES = /\{(\w+)\}/g;

/**
 * Câu theo ngôn ngữ giao diện cho `{ error, variant?, params }` (mã + biến thể có key `errors.*`), không có key → null.
 * Có key nhưng server không gửi đủ `params` cho câu (API cũ chỉ có `{ error, message }`) → `undefined`, để không hiện
 * placeholder `{…}` thô.
 */
function codedText(body: Readonly<Record<string, unknown>>): string | null | undefined {
  const code = str(body.error);
  if (!code) return null;
  const variant = str(body.variant);
  const key = `errors.${variant ? `${code}.${variant}` : code}`;
  if (!hasMessage(key)) return null;
  const params = errorParams(body.params);
  const filled = [...t(key).matchAll(PLACEHOLDER_NAMES)].every((m) => Object.hasOwn(params, m[1] ?? ""));
  return filled ? t(key, params) : undefined;
}

/** `invalid_body` có issue mang mã lỗi API (`params: { error, params }`, VD chữ bỏ qua không hợp lệ) → câu của mã đó. */
function issueText(body: Readonly<Record<string, unknown>>): string | null {
  if (!Array.isArray(body.issues)) return null;
  for (const issue of body.issues as unknown[]) {
    const params = issue && typeof issue === "object" ? (issue as { params?: unknown }).params : undefined;
    const text = params && typeof params === "object" ? codedText(params as Record<string, unknown>) : null;
    if (text) return text;
  }
  return null;
}

/**
 * Câu cho người dùng của một body lỗi API (`{ error, variant?, message, params }`, cũng dùng cho lỗi từng dòng CSV):
 * mã có key `errors.*` → câu theo ngôn ngữ giao diện; key cần tham số mà server không gửi → `message` server gửi, không
 * có thì câu chung kèm mã; không có key → ở tiếng Việt dùng `message` server gửi (`fallback` khi không có), ngôn ngữ
 * khác → câu chung kèm mã trong ngoặc.
 */
export function apiErrorText(body: Readonly<Record<string, unknown>>, fallback = ""): string {
  const issue = issueText(body);
  if (issue) return issue;
  const coded = codedText(body);
  if (coded) return coded;
  const message = str(body.message) ?? str(fallback);
  const code = str(body.error);
  if (coded === undefined && code) return message ?? t("errors.unknown", { code });
  if (i18nStore.getState().locale === BASE_LOCALE || !code) return message ?? code ?? t("errors.generic");
  return t("errors.unknown", { code });
}

export const errorMessage = (e: unknown) => {
  if (e instanceof ApiError) {
    if (e.status === 402 && e.body.error === QUOTA_EXCEEDED) return quotaText(e.body);
    return apiErrorText(e.body, e.message);
  }
  return e && typeof e === "object" && "message" in e
    ? String((e as { message: unknown }).message)
    : t("errors.generic");
};
