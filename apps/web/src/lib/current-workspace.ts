/**
 * Workspace hiện tại cho `/` (home): localStorage `mtl.ws` nếu còn là thành viên; không có → workspace duy nhất;
 * nhiều workspace mà chưa chọn → picker.
 */
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { api, type WorkspaceSummary } from "./api.ts";

const STORAGE_KEY = "mtl.ws";

export type CurrentWs = { ws: string } | { pick: true } | { none: true };

/** Thuần (test được): `stored` chỉ dùng khi còn trong danh sách. */
export function resolveCurrentWs(list: readonly Pick<WorkspaceSummary, "id">[], stored: string | null): CurrentWs {
  if (list.length === 0) return { none: true };
  if (stored && list.some((w) => w.id === stored)) return { ws: stored };
  const only = list.length === 1 ? list[0] : undefined;
  return only ? { ws: only.id } : { pick: true };
}

// localStorage có thể ném (chế độ riêng tư, chặn site data) → coi như chưa chọn.
export function getStoredWs(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// Router giữ nguyên element của route khi điều hướng `/` → `/` → phải subscribe để home đổi theo workspace mới.
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function setCurrentWs(ws: string) {
  if (getStoredWs() === ws) return;
  try {
    localStorage.setItem(STORAGE_KEY, ws);
  } catch {
    // bỏ qua: lần sau lại hỏi picker
  }
  for (const fn of listeners) fn();
}

export const myWorkspacesQuery = {
  queryKey: ["me", "workspaces"],
  queryFn: () => api<{ workspaces: WorkspaceSummary[] }>("/api/me/workspaces"),
  staleTime: 5 * 60_000,
};

export const useMyWorkspaces = () => useQuery(myWorkspacesQuery);

/** `undefined` khi đang tải; lỗi lấy qua `error`. */
export function useCurrentWorkspace(): { current?: CurrentWs; error: unknown } {
  const q = useMyWorkspaces();
  const stored = useSyncExternalStore(subscribe, getStoredWs);
  return { current: q.data && resolveCurrentWs(q.data.workspaces, stored), error: q.error };
}
