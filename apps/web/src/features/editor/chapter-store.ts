/**
 * Dữ liệu cả chương cho màn sửa gộp (1 store/tab, reset khi đổi chương): meta page, cache state (chỉ đọc) của mọi
 * page, page đang sửa (active — cũng là page duy nhất canvas hiện). Page active được sửa qua `editorStore`; cache
 * của nó chỉ cập nhật khi rời page (từ `editorStore.base`) hoặc khi server có version mới.
 */
import type { PageState } from "@mtl/shared";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { PageStatus } from "../chapter/status.ts";
import { clampView, contentBox, pageStartView, type Size, viewAtY } from "./page-layout.ts";
import { editorStore } from "./store.ts";

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
  cache: Record<string, CachedState>;
  activePageId: string | null;
  /** Kích thước khung canvas (px màn hình) — để đặt khung nhìn khi đổi page / cuộn tới khối từ ngoài canvas. */
  box: Size;
  /** Người dùng đã tự zoom → đổi page giữ zoom; chưa → mỗi page vừa khung theo chính nó. */
  zoomed: boolean;
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
  /** Đổi page active; page khác page cũ → khung nhìn về đầu page mới (vừa khung, căn giữa). */
  setActive(pageId: string | null): void;
  setBox(box: Size): void;
  setZoomed(zoomed: boolean): void;
  /**
   * Khung nhìn mở trang của page active: không `scale` = "Vừa khung" (bỏ cờ đã zoom); có `scale` (VD 1 = 100%) = đầu
   * trang sát mép trên ở mức đó, đặt cờ đã zoom (đổi trang giữ mức).
   */
  fitView(scale?: number): void;
  setViewMode(mode: ViewMode): void;
  setHoldOriginal(hold: boolean): void;
};

const initial = (chapterId: string | null): ChapterState => ({
  chapterId,
  pages: [],
  cache: {},
  activePageId: null,
  box: { w: 0, h: 0 },
  zoomed: false,
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
      set({ pages });
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
    setActive: (activePageId) => {
      const s = get();
      if (s.activePageId === activePageId) return;
      set({ activePageId });
      const p = s.pages.find((x) => x.id === activePageId);
      // Khung chưa đo (canvas chưa mount) → canvas tự vừa khung lần đầu.
      if (!p || s.box.w === 0) return;
      const e = editorStore.getState();
      e.setView(
        pageStartView({ w: p.width, h: p.height }, s.viewMode === "split", s.box, s.zoomed ? e.view.scale : undefined),
      );
    },
    setBox: (box) => set({ box }),
    setZoomed: (zoomed) => set({ zoomed }),
    fitView: (scale) => {
      const s = get();
      const p = s.pages.find((x) => x.id === s.activePageId);
      if (!p || s.box.w === 0) return;
      editorStore.getState().setView(pageStartView({ w: p.width, h: p.height }, s.viewMode === "split", s.box, scale));
      set({ zoomed: scale !== undefined });
    },
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

/** Cuộn canvas tới khối (toạ độ page active) chỉ khi khối đang nằm ngoài khung nhìn theo chiều dọc. */
export function revealRect(pageId: string, rect: { y: number; h: number }, margin = 80) {
  const s = chapterStore.getState();
  const p = s.pages.find((x) => x.id === pageId);
  if (!p || s.activePageId !== pageId) return;
  const e = editorStore.getState();
  const vTop = -e.view.y / e.view.scale;
  const vBottom = vTop + s.box.h / e.view.scale;
  if (s.box.h > 0 && rect.y >= vTop && rect.y + rect.h <= vBottom) return;
  const v = viewAtY(e.view, rect.y);
  const c = contentBox({ w: p.width, h: p.height }, s.viewMode === "split");
  e.setView(clampView({ ...v, y: v.y + margin }, c, s.box, c.x));
}
