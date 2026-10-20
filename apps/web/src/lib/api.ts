import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ basePath: "/api/auth", plugins: [organizationClient()] });

/** Header bắt buộc khi đăng ký từ link mời (server kiểm, xem apps/api/src/auth.ts). */
export const INVITATION_HEADER = "x-invitation-id";
export const INVITATION_TOKEN_HEADER = "x-invitation-token";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Body lỗi đầy đủ (VD `rejected`, `holder_name`) để UI hiển thị chi tiết. */
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
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...rest.headers },
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

/** Đường dẫn API của workspace. */
export const wsPath = (ws: string, path = "") => `/api/w/${ws}${path}`;

export type WorkspaceSummary = { id: string; name: string; slug: string };
export type WorkspaceDetail = WorkspaceSummary & {
  role: "owner" | "admin" | "member";
  settings: { worker_mode: string };
};

export const errorMessage = (e: unknown) =>
  e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Có lỗi xảy ra";
