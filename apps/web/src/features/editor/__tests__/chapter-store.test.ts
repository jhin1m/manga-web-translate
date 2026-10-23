import { describe, expect, it } from "vitest";
import { createChapterStore, type PageMeta } from "../chapter-store.ts";
import { EDGE, FIT_EDGE } from "../page-layout.ts";
import { editorStore } from "../store.ts";
import { doc } from "./fixtures.ts";

const meta = (id: string, height: number): PageMeta => ({
  id,
  ord: 0,
  width: 800,
  height,
  status: "ready",
  version: 0,
  clean_rev: 1,
  ai_update_available: false,
});

const row = (page_id: string, version: number, n = 1) => ({
  page_id,
  state: doc(n),
  version,
  ai_rev: 1,
  ai_update_available: false,
});

describe("chapter store", () => {
  it("fitView: no active page is a no-op; 100% sets the zoomed flag, fit clears it", () => {
    const s = createChapterStore();
    s.getState().setPages([meta("a", 1000)]);
    s.getState().setBox({ w: 1200, h: 800 });
    editorStore.getState().setView({ scale: 0.3, x: 1, y: 2 });
    s.getState().fitView(1);
    expect(editorStore.getState().view).toEqual({ scale: 0.3, x: 1, y: 2 });
    expect(s.getState().zoomed).toBe(false);

    s.getState().setActive("a");
    s.getState().fitView(1);
    expect(editorStore.getState().view).toEqual({ scale: 1, x: 200, y: FIT_EDGE });
    expect(s.getState().zoomed).toBe(true);
    s.getState().fitView();
    expect(editorStore.getState().view.scale).toBeLessThan(1);
    expect(s.getState().zoomed).toBe(false);
  });

  it("switching page opens the new page at its top, centered; zoom is kept once the user zoomed", () => {
    const s = createChapterStore();
    s.getState().setPages([meta("a", 1000), { ...meta("b", 2000), width: 400 }]);
    s.getState().setBox({ w: 1200, h: 800 });
    s.getState().setActive("a");
    editorStore.getState().setView({ scale: 1, x: 0, y: -700 });
    s.getState().setActive("b");
    expect(editorStore.getState().view).toEqual({ scale: 1, x: 400, y: FIT_EDGE });
    // Cùng page → không đụng khung nhìn.
    editorStore.getState().setView({ scale: 1, x: 400, y: -500 });
    s.getState().setActive("b");
    expect(editorStore.getState().view.y).toBe(-500);

    s.getState().setZoomed(true);
    editorStore.getState().setView({ scale: 0.5, x: 0, y: -300 });
    s.getState().setActive("a");
    // Page thấp hơn khung ở zoom này → kẹp về lề trên.
    expect(editorStore.getState().view).toEqual({ scale: 0.5, x: 400, y: EDGE });
  });

  it("setStates ignores an older version of the active page (late response)", () => {
    const s = createChapterStore();
    s.getState().setActive("a");
    s.getState().setStates([row("a", 1), row("b", 1)]);
    // Rời page a sau khi lưu → cache = base mới (version 3).
    s.getState().setCached("a", { state: doc(3), version: 3 });
    const fresh = s.getState().cache.a;
    s.getState().setStates([row("a", 2), row("b", 2, 2)]);
    expect(s.getState().cache.a).toBe(fresh);
    expect(s.getState().cache.b?.version).toBe(2);
    s.getState().setStates([row("a", 4, 4)]);
    expect(s.getState().cache.a?.version).toBe(4);
  });
});
