import { type PipelineSettings, QUOTA_EXCEEDED } from "@mtl/shared";
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
    const msg = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : "";
    throw new ApiError(res.status, msg || res.statusText, data);
  }
  return data as T;
}

/** Hạn mức chi phí hôm nay (`limit_usd` null = không giới hạn). */
export type Quota = { spent_usd: number; limit_usd: number | null; resets_at: string };

/** `GET /api/me`: người đang đăng nhập + cài đặt chung + hạn mức hôm nay. */
export type Me = {
  id: string;
  email: string;
  name: string;
  settings: { pipeline: PipelineSettings };
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
