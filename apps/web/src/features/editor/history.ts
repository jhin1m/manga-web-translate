/**
 * Undo/redo thống nhất theo page bằng immer patches (không clone toàn state mỗi bước).
 * Thao tác liên tục cùng `key` (kéo slider cỡ chữ, gõ trong ô bản dịch) trong COALESCE_MS gộp thành 1 bước.
 */
import { applyPatches, type Draft, enablePatches, type Patch, produceWithPatches } from "immer";

enablePatches();

export const HISTORY_LIMIT = 200;
export const COALESCE_MS = 1000;

export type HistoryEntry = { patches: Patch[]; inverse: Patch[]; key: string | null; at: number };
export type History = { past: HistoryEntry[]; future: HistoryEntry[] };

export const emptyHistory = (): History => ({ past: [], future: [] });

/** Áp recipe → state mới + patch xuôi/ngược; state không đổi → patches rỗng. */
// biome-ignore lint/suspicious/noConfusingVoidType: cùng kiểu recipe của immer (sửa draft tại chỗ hoặc trả state mới).
export function change<S>(state: S, recipe: (draft: Draft<S>) => void | S) {
  const [next, patches, inverse] = produceWithPatches(state, recipe as (draft: Draft<S>) => void);
  return { state: next as S, patches, inverse };
}

/** Ghi 1 bước; cùng key với bước trước trong COALESCE_MS → gộp. Bước mới xoá nhánh redo. */
export function record(h: History, patches: Patch[], inverse: Patch[], key: string | null, now = Date.now()): History {
  if (patches.length === 0) return h;
  const last = h.past.at(-1);
  if (key && last && last.key === key && now - last.at <= COALESCE_MS) {
    const merged: HistoryEntry = {
      patches: [...last.patches, ...patches],
      inverse: [...inverse, ...last.inverse],
      key,
      at: now,
    };
    return { past: [...h.past.slice(0, -1), merged], future: [] };
  }
  const past = [...h.past, { patches, inverse, key, at: now }];
  return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, future: [] };
}

export function undo<S>(state: S, h: History): { state: S; history: History } | null {
  const last = h.past.at(-1);
  if (!last) return null;
  return {
    state: applyPatches(state as object, last.inverse) as S,
    history: { past: h.past.slice(0, -1), future: [{ ...last, key: null }, ...h.future] },
  };
}

export function redo<S>(state: S, h: History): { state: S; history: History } | null {
  const [next, ...rest] = h.future;
  if (!next) return null;
  return {
    state: applyPatches(state as object, next.patches) as S,
    history: { past: [...h.past, next], future: rest },
  };
}
