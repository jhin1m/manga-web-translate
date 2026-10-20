import { describe, expect, it } from "vitest";
import { createChapterStore, type PageMeta } from "../chapter-store.ts";
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
  it("computes strip offsets from page heights", () => {
    const s = createChapterStore();
    s.getState().setPages([meta("a", 1000), meta("b", 2000), meta("c", 500)]);
    expect(s.getState().offsets).toEqual([0, 1000, 3000]);
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
