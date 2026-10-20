import type { PageState } from "@mtl/shared";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { serial } from "../../chapter/use-chapter-lock.ts";
import { editText, moveBox } from "../actions.ts";
import { change } from "../history.ts";
import { PendingQueue } from "../pending-queue.ts";
import { finalSave, type SaveApi, Saver } from "../save.ts";
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

describe("final save on leaving the editor", () => {
  it("runs in the lock chain before the queued unlock, so the PUT lands while the lock is held", async () => {
    const { store, srv, saver } = setup();
    store.getState().apply(moveBox("t0", 11, 12));
    const relock = async () => {
      srv.locked = true;
    };
    // Thứ tự cleanup khi unmount: lượt lưu cuối xếp trước, lệnh nhả khoá của useChapterLock xếp sau.
    const save = serial(() => finalSave(saver, store, relock));
    const unlock = serial(async () => {
      srv.locked = false;
    });
    await Promise.all([save, unlock]);
    expect(srv.state.text_boxes[0]).toMatchObject({ x: 11, y: 12 });
    // Một PUT duy nhất: không có vòng 423 → lấy lại khoá.
    expect(srv.puts).toBe(1);
    expect(store.getState().save.status).toBe("saved");
    expect(srv.locked).toBe(false);
  });

  it("re-acquires a lock lost earlier (423) and saves", async () => {
    const { store, srv, queue, saver } = setup();
    srv.locked = false;
    store.getState().apply(moveBox("t0", 21, 22));
    await saver.flush();
    expect(store.getState().readOnly).toBe("lock_lost");
    await serial(() =>
      finalSave(saver, store, async () => {
        srv.locked = true;
      }),
    );
    expect(srv.state.text_boxes[0]).toMatchObject({ x: 21, y: 22 });
    expect(await queue.get("p1")).toBeUndefined();
  });

  it("keeps edits in IndexedDB when the lock cannot be re-acquired", async () => {
    const { store, srv, queue, saver } = setup();
    srv.locked = false;
    store.getState().apply(moveBox("t0", 31, 32));
    await serial(() =>
      finalSave(saver, store, async () => {
        throw new Error("423");
      }),
    );
    expect(srv.puts).toBe(1);
    expect((await queue.get("p1"))?.ops.length).toBeGreaterThan(0);
  });

  it("saves a snapshot taken before another session resets the shared store, then the unlock runs", async () => {
    const { store, srv, queue, saver } = setup();
    store.getState().apply(moveBox("t0", 41, 42));
    // Phiên chương mới: giao sửa chưa lưu cho Saver cũ rồi reset store ngay (lúc render, trước cleanup phiên cũ).
    const detached = saver.flushDetached();
    store.getState().reset();
    // Cleanup phiên cũ sau đó: lượt lưu cuối (store đã rỗng → không gì) rồi nhả khoá, cùng chuỗi `serial`.
    const save = serial(() => finalSave(saver, store, async () => undefined));
    const unlock = serial(async () => {
      srv.locked = false;
    });
    await Promise.all([detached, save, unlock]);
    expect(srv.state.text_boxes[0]).toMatchObject({ x: 41, y: 42 });
    expect(srv.puts).toBe(1);
    expect(await queue.get("p1")).toBeUndefined();
    expect(store.getState().pageId).toBeNull();
  });

  it("detached save racing an in-flight autosave rebases onto the saved version (409) and clears the draft", async () => {
    const store = createEditorStore();
    const { srv, api } = fakeServer(doc(2));
    const queue = new PendingQueue(new IDBFactory());
    store.getState().load({ pageId: "p1", state: doc(2), version: 1, ai: { state: null, rev: 0, available: false } });
    store.getState().setReadOnly(null);
    // PUT đầu tiên treo tới khi thả → mô phỏng autosave đang bay.
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const gated: SaveApi = {
      ...api,
      put: async (id, state, version) => {
        if (calls++ === 0) await gate;
        return api.put(id, state, version);
      },
    };
    const saver = new Saver(store, gated, queue, { debounceMs: 10_000, persistMs: 10_000, retryMs: 10_000 });
    store.getState().apply(moveBox("t0", 61, 62));
    const inFlight = saver.flush();
    await expect.poll(() => calls).toBe(1);
    // Autosave đang bay (version 1 → 2) thì người dùng sửa tiếp rồi đổi chương ngay.
    store.getState().apply(editText("t0", "sửa sau", layout));
    const detached = saver.flushDetached();
    store.getState().reset();
    release();
    await Promise.all([inFlight, detached]);
    expect(srv.state.text_boxes[0]).toMatchObject({ x: 61, y: 62, text: "sửa sau" });
    expect(srv.version).toBe(3);
    expect(await queue.get("p1")).toBeUndefined();
  });

  it("detached save that fails keeps the edits in IndexedDB", async () => {
    const { store, srv, queue, saver } = setup();
    store.getState().apply(moveBox("t0", 51, 52));
    srv.locked = false;
    const detached = saver.flushDetached();
    store.getState().reset();
    await detached;
    expect(srv.puts).toBe(1);
    expect((await queue.get("p1"))?.ops.length).toBeGreaterThan(0);
  });

  it("detached save is a no-op without unsaved edits", async () => {
    const { srv, saver } = setup();
    await saver.flushDetached();
    expect(srv.puts).toBe(0);
  });
});
