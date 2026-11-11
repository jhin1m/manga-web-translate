import { QUOTA_EXCEEDED } from "@mtl/shared";
import { useQuery } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/react";

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

/** Gọi API JSON cùng origin; lỗi HTTP → ApiError. 204 → undefined. */
export async function api<T>(path: string, init: Omit<RequestInit, "body"> & { body?: unknown } = {}): Promise<T> {
  const { body, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    credentials: "same-origin",
    headers: {
      "x-tab-id": tabId(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...rest.headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    onSessionLost(res.status, data);
    const msg = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : "";
    throw new ApiError(res.status, msg || res.statusText, data);
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

/** `GET /api/me`: người đang đăng nhập + quyền admin + hạn mức hôm nay. */
export type Me = {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
  quota: Quota;
};

export const usd = (n: number) => `$${n.toFixed(2)}`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

/** Câu báo hết hạn mức ngày (402 `quota_exceeded`). */
export const quotaText = (q: { spent_usd?: unknown; limit_usd?: unknown; resets_at?: unknown }) =>
  `Đã dùng hết hạn mức hôm nay (${usd(Number(q.spent_usd ?? 0))} / ${usd(Number(q.limit_usd ?? 0))})` +
  (typeof q.resets_at === "string" ? ` — thử lại sau ${clock(q.resets_at)}` : "");

export const errorMessage = (e: unknown) => {
  if (e instanceof ApiError && e.status === 402 && e.body.error === QUOTA_EXCEEDED) return quotaText(e.body);
  return e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Có lỗi xảy ra";
};
