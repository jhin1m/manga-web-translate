import type { PageState } from "@mtl/shared";
import { describe, expect, it } from "vitest";
import { addBox, deleteBox, editText, moveBox, setStyle } from "../actions.ts";
import {
  batchOnTop,
  change,
  emptyHistory,
  HISTORY_LIMIT,
  type History,
  record,
  recordBatch,
  redo,
  settleBatch,
  undo,
} from "../history.ts";
import { box, doc, layout } from "./fixtures.ts";

type Recipe = Parameters<typeof change<PageState>>[1];

function step(s: PageState, h: History, recipe: Recipe, key: string | null = null, at = 0) {
  const r = change(s, recipe);
  return { s: r.state, h: record(h, r.patches, r.inverse, key, at) };
}

describe("history", () => {
  it("undoes and redoes 120 mixed operations exactly", () => {
    const start = doc(3);
    let s = start;
    let h = emptyHistory();
    const snapshots: PageState[] = [s];
    for (let i = 0; i < 120; i++) {
      const id = `t${i % 3}`;
      const recipes: Recipe[] = [
        moveBox(id, i, i * 2),
        editText(id, `Lần ${i} ệ ẫ ữ`, layout),
        setStyle(id, { font_size: 12 + (i % 20), align: i % 2 ? "left" : "right" }, layout),
        addBox(box(`n${i}`)),
        deleteBox(`n${i - 1}`),
      ];
      const prev = s;
      ({ s, h } = step(s, h, recipes[i % recipes.length] as Recipe, null, i * 10_000));
      if (s !== prev) snapshots.push(s);
    }
    const end = s;
    expect(h.past.length).toBeGreaterThanOrEqual(100);
    let n = 0;
    for (;;) {
      const r = undo(s, h);
      if (!r) break;
      ({ state: s, history: h } = r);
      n++;
      expect(s).toEqual(snapshots[snapshots.length - 1 - n]);
    }
    expect(s).toEqual(start);
    for (;;) {
      const r = redo(s, h);
      if (!r) break;
      ({ state: s, history: h } = r);
    }
    expect(s).toEqual(end);
  });

  it("coalesces steps with the same key inside the window into one", () => {
    let s = doc(1);
    let h = emptyHistory();
    for (let i = 0; i < 10; i++) ({ s, h } = step(s, h, moveBox("t0", i, i), "drag:t0", 1000 + i * 100));
    expect(h.past).toHaveLength(1);
    ({ s, h } = step(s, h, moveBox("t0", 99, 99), "drag:t0", 1000 + 9 * 100 + 5000));
    expect(h.past).toHaveLength(2);
    const r = undo(s, h);
    const r2 = r && undo(r.state, r.history);
    expect(r2?.state).toEqual(doc(1));
  });

  it("drops the oldest steps beyond the limit and clears redo on new step", () => {
    let s = doc(1);
    let h = emptyHistory();
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) ({ s, h } = step(s, h, moveBox("t0", i, 0), null, i * 10_000));
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    const u = undo(s, h);
    expect(u?.history.future).toHaveLength(1);
    const after = u && step(u.state, u.history, moveBox("t0", -1, -1));
    expect(after?.h.future).toHaveLength(0);
  });

  it("ignores no-op changes", () => {
    const s = doc(1);
    const r = change(s, moveBox("missing", 1, 1));
    expect(record(emptyHistory(), r.patches, r.inverse, null).past).toHaveLength(0);
  });

  describe("bulk edit mark", () => {
    const step = (h: History, x: number) => {
      const r = change(doc(1), moveBox("t0", x, x));
      return record(h, r.patches, r.inverse, null);
    };
    const mark = (id: string, touches = true) => ({ id, before: touches ? {} : null, after: touches ? {} : null });

    it("is a step of its own, clears redo and is on top until another edit", () => {
      let h = step(emptyHistory(), 1);
      h = undo(doc(1), h)?.history ?? h;
      expect(h.future).toHaveLength(1);
      h = recordBatch(h, mark("b1"));
      expect(h.future).toHaveLength(0);
      expect(batchOnTop(h)?.id).toBe("b1");
      expect(batchOnTop(step(h, 2))).toBeNull();
    });

    it("settle restored keeps the steps before the mark and drops the rest", () => {
      let h = recordBatch(step(step(emptyHistory(), 1), 2), mark("b1"));
      h = step(h, 3);
      const out = settleBatch(h, "b1", "restored");
      expect(out.past).toHaveLength(2);
      expect(out.future).toHaveLength(0);
    });

    it("settle orphaned keeps the steps after the mark and drops the earlier ones", () => {
      let h = recordBatch(step(emptyHistory(), 1), mark("b1"));
      h = step(h, 3);
      expect(settleBatch(h, "b1", "orphaned").past).toHaveLength(1);
    });

    it("settle on a mark that did not touch the page only removes the mark", () => {
      const h = step(recordBatch(step(emptyHistory(), 1), mark("b1", false)), 3);
      expect(settleBatch(h, "b1", "orphaned").past).toHaveLength(2);
      expect(settleBatch(h, "other", "restored")).toBe(h);
    });
  });
});
