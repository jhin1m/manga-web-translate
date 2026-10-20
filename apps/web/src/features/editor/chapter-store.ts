/**
 * Dữ liệu cả chương cho màn sửa gộp (1 store/tab, reset khi đổi chương): meta page + offset trên strip, cache
 * state (chỉ đọc) của mọi page, page đang sửa (active) và page ở giữa khung nhìn. Page active được sửa qua
 * `editorStore`; cache của nó chỉ cập nhật khi rời page (từ `editorStore.base`) hoặc khi server có version mới.
 */
import type { PageState } from "@mtl/shared";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { PageStatus } from "../chapter/status.ts";
import { editorStore } from "./store.ts";
import { clampView, contentBox, pageOffsets, type Size, stripSize, viewAtOffset } from "./strip-layout.ts";

export type PageMeta = {
  id: string;
  ord: number;
  width: number;
  height: number;
  status: PageStatus;
  version: number;
  clean_rev: number | null;
  ai_update_available: boolean;
};

export type CachedState = {
  /** null: page chưa có state (chưa dịch) — vẽ ảnh, không có chữ. */
  state: PageState | null;
  version: number;
  ai_rev: number;
  ai_update_available: boolean;
};

/** Gốc = ảnh gốc, ẩn chữ; Dịch = ảnh sạch + chữ; Chia đôi = gốc (trái) cạnh dịch (phải) trên cùng 1 canvas. */
export type ViewMode = "original" | "translated" | "split";

export type ChapterState = {
  chapterId: string | null;
  pages: PageMeta[];
  offsets: number[];
  cache: Record<string, CachedState>;
  activePageId: string | null;
  centerPageId: string | null;
  /** Kích thước khung canvas (px màn hình) — để kẹp khung nhìn khi cuộn tới page từ ngoài canvas. */
  box: Size;
  viewMode: ViewMode;
  /** Đang giữ `O`: tạm xem ảnh gốc, nhả = về `viewMode`. */
  holdOriginal: boolean;
};

export type ChapterActions = {
  reset(chapterId: string | null): void;
  setPages(pages: PageMeta[]): void;
  /** Ghi state từ server; bỏ qua bản có version cũ hơn bản đang cache (VD request về muộn). */
  setStates(rows: ({ page_id: string } & CachedState)[]): void;
  setCached(pageId: string, entry: Partial<CachedState> & { version: number }): void;
  setActive(pageId: string | null): void;
  setCenter(pageId: string | null): void;
  setBox(box: Size): void;
  setViewMode(mode: ViewMode): void;
  setHoldOriginal(hold: boolean): void;
};

const initial = (chapterId: string | null): ChapterState => ({
  chapterId,
  pages: [],
  offsets: [],
  cache: {},
  activePageId: null,
  centerPageId: null,
  box: { w: 0, h: 0 },
  viewMode: "translated",
  holdOriginal: false,
});

/** Chế độ đang hiển thị: giữ `O` → Gốc (chia đôi: cột phải cũng hiện gốc, bố cục giữ nguyên). */
export const effectiveMode = (s: Pick<ChapterState, "viewMode" | "holdOriginal">): ViewMode =>
  s.holdOriginal ? "original" : s.viewMode;

const samePages = (a: PageMeta[], b: PageMeta[]) =>
  a.length === b.length &&
  a.every((p, i) => {
    const q = b[i] as PageMeta;
    return (
      p.id === q.id &&
      p.height === q.height &&
      p.width === q.width &&
      p.status === q.status &&
      p.version === q.version &&
      p.clean_rev === q.clean_rev &&
      p.ai_update_available === q.ai_update_available
    );
  });

export function createChapterStore() {
  return createStore<ChapterState & ChapterActions>()((set, get) => ({
    ...initial(null),
    reset: (chapterId) => set(initial(chapterId)),
    setPages: (pages) => {
      if (samePages(get().pages, pages)) return;
      set({ pages, offsets: pageOffsets(pages.map((p) => p.height)) });
    },
    setStates: (rows) =>
      set((s) => {
        let cache = s.cache;
        for (const { page_id, ...entry } of rows) {
          const cur = cache[page_id];
          if (cur && entry.version < cur.version) continue;
          if (
            cur &&
            entry.version === cur.version &&
            cur.ai_update_available === entry.ai_update_available &&
            cur.ai_rev === entry.ai_rev
          ) {
            continue;
          }
          if (cache === s.cache) cache = { ...s.cache };
          cache[page_id] = entry;
        }
        return cache === s.cache ? s : { cache };
      }),
    setCached: (pageId, entry) =>
      set((s) => {
        const cur = s.cache[pageId];
        if (cur && entry.version < cur.version) return s;
        const next: CachedState = {
          state: null,
          ai_rev: 0,
          ai_update_available: false,
          ...cur,
          ...entry,
        };
        return { cache: { ...s.cache, [pageId]: next } };
      }),
    setActive: (activePageId) => set({ activePageId }),
    setCenter: (centerPageId) => set({ centerPageId }),
    setBox: (box) => set({ box }),
    setViewMode: (viewMode) => set({ viewMode }),
    setHoldOriginal: (holdOriginal) => {
      if (get().holdOriginal !== holdOriginal) set({ holdOriginal });
    },
  }));
}

export type ChapterStore = ReturnType<typeof createChapterStore>;

/** Store dùng chung của màn chương (1 màn mỗi tab). */
export const chapterStore = createChapterStore();

// `editorStore.showOriginal` giữ cho tương thích: suy ra từ chế độ xem của màn chương.
chapterStore.subscribe((s) => {
  const v = effectiveMode(s) === "original";
  if (editorStore.getState().showOriginal !== v) editorStore.getState().setShowOriginal(v);
});

export function useChapterStore<T>(selector: (s: ChapterState & ChapterActions) => T): T {
  return useStore(chapterStore, selector);
}

/** Offset trên strip của page đang sửa (0 khi chưa có). */
export function activeOffset(s: ChapterState = chapterStore.getState()): number {
  const i = s.pages.findIndex((p) => p.id === s.activePageId);
  return i >= 0 ? (s.offsets[i] ?? 0) : 0;
}

/** Cuộn khung nhìn để điểm `y` (toạ độ page) của page nằm gần mép trên khung (`margin` px màn hình). */
export function focusPage(pageId: string, y = 0, margin = 0) {
  const s = chapterStore.getState();
  const i = s.pages.findIndex((p) => p.id === pageId);
  if (i < 0) return;
  const e = editorStore.getState();
  const v = viewAtOffset(e.view, (s.offsets[i] ?? 0) + y);
  const c = contentBox(stripSize(s.pages.map((p) => ({ w: p.width, h: p.height }))), s.viewMode === "split");
  e.setView(clampView({ ...v, y: v.y + margin }, c, s.box, c.x));
}

/** Cuộn canvas tới khối (toạ độ page) chỉ khi khối đang nằm ngoài khung nhìn theo chiều dọc. */
export function revealRect(pageId: string, rect: { y: number; h: number }, margin = 80) {
  const s = chapterStore.getState();
  const i = s.pages.findIndex((p) => p.id === pageId);
  if (i < 0) return;
  const { view } = editorStore.getState();
  const top = (s.offsets[i] ?? 0) + rect.y;
  const vTop = -view.y / view.scale;
  const vBottom = vTop + s.box.h / view.scale;
  if (s.box.h > 0 && top >= vTop && top + rect.h <= vBottom) return;
  focusPage(pageId, rect.y, margin);
}
