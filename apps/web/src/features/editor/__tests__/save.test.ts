import type { PageState } from "@mtl/shared";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { editText, moveBox } from "../actions.ts";
import { change } from "../history.ts";
import { PendingQueue } from "../pending-queue.ts";
import { type SaveApi, Saver } from "../save.ts";
import { createEditorStore } from "../store.ts";
import { doc, layout } from "./fixtures.ts";

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** Server giả: version + state, có thể đổi state "từ người khác" giữa chừng. */
function fakeServer(initial: PageState) {
  const srv = { state: initial, version: 1, locked: true, puts: 0 };
  const api: SaveApi = {
    async put(_id, state, version) {
      srv.puts++;
      if (!srv.locked) throw new HttpError(423);
      if (version !== srv.version) throw new HttpError(409);
      srv.state = structuredClone(state);
      srv.version++;
      return { version: srv.version };
    },
    async get() {
      return { state: structuredClone(srv.state), version: srv.version };
    },
  };
  return { srv, api };
}

function setup() {
  const store = createEditorStore();
  const { srv, api } = fakeServer(doc(2));
  const queue = new PendingQueue(new IDBFactory());
  store.getState().load({ pageId: "p1", state: doc(2), version: 1, ai: { state: null, rev: 0, available: false } });
  // Đang giữ khoá chương.
  store.getState().setReadOnly(null);
  const saver = new Saver(store, api, queue, { debounceMs: 10_000, persistMs: 10_000, retryMs: 10_000 });
  return { store, srv, queue, saver };
}

describe("Saver", () => {
  it("200: saves with If-Match, clears the IndexedDB record", async () => {
    const { store, srv, queue, saver } = setup();
    store.getState().apply(moveBox("t0", 5, 5));
    await saver.flush();
    expect(srv.version).toBe(2);
    expect(srv.state.text_boxes[0]).toMatchObject({ x: 5 });
    expect(store.getState()).toMatchObject({ baseVersion: 2, save: { status: "saved" } });
    expect(await queue.get("p1")).toBeUndefined();
  });

  it("409: reloads server state, rebases pending edits, lists conflicts, saves again", async () => {
    const { store, srv, saver } = setup();
    // Người khác lưu trước: sửa chữ t1 và t0.
    srv.state = change(srv.state, editText("t1", "người khác", layout)).state;
    srv.state = change(srv.state, editText("t0", "người khác 0", layout)).state;
    srv.version = 5;
    store.getState().apply(moveBox("t1", 42, 43));
    store.getState().apply(editText("t0", "của tôi", layout));
    await saver.flush();
    expect(srv.version).toBe(6);
    const t1 = srv.state.text_boxes.find((b) => b.id === "t1");
    expect(t1).toMatchObject({ x: 42, y: 43, text: "người khác" });
    expect(srv.state.text_boxes.find((b) => b.id === "t0")?.text).toBe("người khác 0");
    expect(
      store
        .getState()
        .conflicts.map((c) => c.key)
        .sort(),
    ).toEqual(["regions:r0", "text_boxes:t0"]);
    // Khôi phục 1 xung đột → thành thay đổi thường, lưu tiếp được.
    store.getState().resolveConflict("text_boxes:t0", true);
    await saver.flush();
    expect(srv.state.text_boxes.find((b) => b.id === "t0")?.text).toBe("của tôi");
  });

  it("423: switches to read-only and keeps edits in IndexedDB", async () => {
    const { store, srv, queue, saver } = setup();
    srv.locked = false;
    store.getState().apply(moveBox("t0", 7, 7));
    await saver.flush();
    expect(store.getState().readOnly).toBe("lock_lost");
    expect(store.getState().save.status).toBe("error");
    expect((await queue.get("p1"))?.ops.length).toBeGreaterThan(0);
    store.getState().apply(moveBox("t0", 8, 8));
    expect(store.getState().doc?.text_boxes[0]?.x).toBe(7);
  });

  it("409 then failing reload → error status (not stuck in saving), retries later", async () => {
    const { store, srv, saver } = setup();
    srv.version = 9;
    const failing = new Saver(
      store,
      {
        put: async () => {
          throw new HttpError(409);
        },
        get: async () => {
          throw new Error("mạng lỗi");
        },
      },
      new PendingQueue(new IDBFactory()),
      { debounceMs: 10_000, persistMs: 10_000, retryMs: 60_000 },
    );
    store.getState().apply(moveBox("t0", 1, 1));
    await failing.flush();
    expect(store.getState().save).toEqual({ status: "error", error: "mạng lỗi" });
    failing.dispose();
    saver.dispose();
  });

  it("keeps undo history when the server only bumped the version", async () => {
    const { store, srv, saver } = setup();
    srv.version = 4;
    store.getState().apply(moveBox("t0", 3, 3));
    await saver.flush();
    expect(srv.version).toBe(5);
    expect(store.getState().history.past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().doc?.text_boxes[0]?.x).toBe(10);
  });
});

describe("store", () => {
  it("undoes 100 store-level edits back to the loaded state", () => {
    const store = createEditorStore();
    store.getState().load({ pageId: "p", state: doc(2), version: 1, ai: { state: null, rev: 0, available: false } });
    store.getState().setReadOnly(null);
    for (let i = 0; i < 100; i++) {
      store.getState().apply(i % 2 ? moveBox("t0", i, i) : editText("t1", `Lần ${i}`, layout));
    }
    expect(store.getState().history.past).toHaveLength(100);
    for (let i = 0; i < 100; i++) store.getState().undo();
    expect(store.getState().doc).toEqual(doc(2));
    for (let i = 0; i < 100; i++) store.getState().redo();
    expect(store.getState().doc?.text_boxes[1]?.text).toBe("Lần 98");
  });
});
