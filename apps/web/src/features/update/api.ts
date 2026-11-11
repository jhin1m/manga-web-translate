import type { UpdateRun, UpdateStatus } from "@mtl/shared/update";
import { type AppConfig, api } from "../../lib/api.ts";

export const UPDATE_STATUS_KEY = ["update-status"] as const;

/** Chỉ bật khi là admin của bản local; 404 / lỗi coi như không có gì (API cũ, bản nhiều người dùng). */
export const updateStatusQuery = (enabled: boolean) => ({
  queryKey: UPDATE_STATUS_KEY,
  queryFn: () => api<UpdateStatus>("/api/admin/update"),
  enabled,
  staleTime: 10 * 60_000,
  retry: 0,
  refetchOnWindowFocus: false,
});

const POLL_TIMEOUT_MS = 5000;

/** Hỏi status lúc đang theo dõi: không cache, quá 5s coi như app không trả lời. */
export const pollStatus = () =>
  api<UpdateStatus>("/api/admin/update", { cache: "no-store", signal: AbortSignal.timeout(POLL_TIMEOUT_MS) });

/** Phiên bản app đang chạy, hỏi `/api/config` (public, không cache). */
export const pollVersion = () =>
  api<AppConfig>("/api/config", { cache: "no-store", signal: AbortSignal.timeout(POLL_TIMEOUT_MS) }).then(
    (c) => c.version ?? null,
  );

export const startUpdate = (version: string) =>
  api<{ run: UpdateRun }>("/api/admin/update", { method: "POST", body: { version } });

const SEEN_KEY = "mtl.update.seen";

/** Phiên bản mới nhất người dùng đã thấy (mở menu). localStorage bị chặn → coi như chưa thấy. */
export function readSeenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function writeSeenVersion(version: string): void {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    // Bị chặn: chấm sẽ hiện lại lần sau, không sao.
  }
}
