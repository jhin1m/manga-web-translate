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
  ) {
    super(message);
  }
}

/** Gọi API JSON cùng origin; lỗi HTTP → ApiError. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  return body as T;
}

export type WorkspaceSummary = { id: string; name: string; slug: string };
export type WorkspaceDetail = WorkspaceSummary & {
  role: "owner" | "admin" | "member";
  settings: { worker_mode: string };
};

export function navigate(to: string) {
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}

export const errorMessage = (e: unknown) =>
  e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Có lỗi xảy ra";
