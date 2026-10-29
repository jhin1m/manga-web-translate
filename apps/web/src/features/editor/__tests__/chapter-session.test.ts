import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { moveBox } from "../actions.ts";
import { createChapterStore } from "../chapter-store.ts";
import { PendingQueue } from "../pending-queue.ts";
import { diffStates } from "../rebase.ts";
import { Saver } from "../save.ts";
import { createEditorStore } from "../store.ts";
import { ChapterSession, type SessionDeps, UnsavedPageError } from "../use-chapter-session.ts";
import { doc } from "./fixtures.ts";

const NO_AI = { state: null, rev: 0, available: false };

/** Server giả nhiều page + nhật ký thứ tự gọi. */
function setup() {
  const log: string[] = [];
  const errors: unknown[] = [];
  const srv: Record<string, { state: ReturnType<typeof doc>; version: number }> = {
    A: { state: doc(2), version: 1 },
    B: { state: doc(3), version: 1 },
  };
  const editor = createEditorStore();
  const chapter = createChapterStore();
  const queue = new PendingQueue(new IDBFactory());
  const api = {
    async put(id: string, state: ReturnType<typeof doc>, version: number) {
      log.push(`put:${id}`);
      const cur = srv[id];
      if (!cur || cur.version !== version) throw Object.assign(new Error("409"), { status: 409 });
      srv[id] = { state: structuredClone(state), version: version + 1 };
      return { version: version + 1 };
    },
    async get(id: string) {
      const cur = srv[id] as { state: ReturnType<typeof doc>; version: number };
      return { state: structuredClone(cur.state), version: cur.version, ai: NO_AI };
    },
  };
  const saver = new Saver(editor, api, queue, { debounceMs: 10_000, persistMs: 10_000, retryMs: 10_000 });
  const orig = editor.getState().load;
  editor.setState({
    load: (p) => {
      log.push(`load:${p.pageId}`);
      orig(p);
    },
  });
  const deps: SessionDeps = {
    editor,
    chapter,
    saver,
    fetchPage: async (id) => {
      log.push(`get:${id}`);
      return api.get(id);
    },
    putState: (id, state, version) => api.put(id, state, version),
    queue,
    onError: (e) => {
      errors.push(e);
    },
  };
  chapter
    .getState()
    .setStates(Object.entries(srv).map(([page_id, v]) => ({ page_id, ...v, ai_rev: 0, ai_update_available: false })));
  editor.getState().setReadOnly(null);
  return { log, errors, srv, editor, chapter, saver, queue, session: new ChapterSession(deps) };
}

describe("ChapterSession", () => {
  it("activate(B) while A is dirty saves A before loading B; back to A keeps undo", async () => {
    const { log, srv, editor, chapter, session } = setup();
    await session.activate("A");
    editor.getState().apply(moveBox("t0", 7, 7));
    log.length = 0;

    await session.activate("B");
    expect(log.indexOf("put:A")).toBeGreaterThanOrEqual(0);
    expect(log.indexOf("put:A")).toBeLessThan(log.indexOf("load:B"));
    expect(srv.A?.version).toBe(2);
    expect(editor.getState().pageId).toBe("B");
    expect(chapter.getState().activePageId).toBe("B");
    // Cache của A = base đã lưu (version mới).
    expect(chapter.getState().cache.A?.version).toBe(2);

    await session.activate("A");
    expect(editor.getState().doc?.text_boxes[0]).toMatchObject({ x: 7 });
    editor.getState().undo();
    expect(editor.getState().doc?.text_boxes[0]).toMatchObject({ x: 10 });
  });

  it("refuses to leave a page whose edits cannot be saved (lost lock) — edits stay in the editor", async () => {
    const { errors, editor, srv, queue, session } = setup();
    await session.activate("A");
    editor.getState().apply(moveBox("t0", 9, 9));
    srv.A = { state: doc(2), version: 99 };
    // Server từ chối mọi lượt lưu: giả lập mất khoá.
    editor.getState().setReadOnly("lock_lost");
    await session.activate("B");
    expect(editor.getState().pageId).toBe("A");
    expect(editor.getState().doc?.text_boxes[0]).toMatchObject({ x: 9 });
    expect(errors[0]).toBeInstanceOf(UnsavedPageError);
    expect((await queue.get("A"))?.ops.length).toBeGreaterThan(0);
  });

  it("rapid clicks only load the last requested page", async () => {
    const { log, editor, session } = setup();
    await session.activate("A");
    log.length = 0;
    void session.activate("B");
    await session.activate("A");
    expect(editor.getState().pageId).toBe("A");
    expect(log.filter((l) => l.startsWith("load:"))).toEqual([]);
  });

  it("runAi flushes then calls the API and keeps the lock", async () => {
    const { log, editor, session } = setup();
    await session.activate("A");
    editor.getState().apply(moveBox("t0", 3, 3));
    log.length = 0;
    const out = await session.runAi(async () => {
      log.push("api");
      return 42;
    });
    expect(out).toBe(42);
    expect(log).toEqual(["put:A", "api"]);
  });

  it("the active page becomes read-only while busy and editable again when done", async () => {
    const { editor, chapter, session } = setup();
    await session.activate("A");
    session.setBusy(new Set(["A"]));
    expect(editor.getState().readOnly).toBe("page_busy");
    // Lô của trang xong: bản AI mới vào cache → hết bận thì nạp bản đó và mở sửa.
    chapter.getState().setStates([{ page_id: "A", state: doc(4), version: 2, ai_rev: 1, ai_update_available: false }]);
    session.setBusy(new Set());
    expect(editor.getState().readOnly).toBeNull();
    expect(editor.getState()).toMatchObject({ baseVersion: 2 });
    expect(editor.getState().doc?.regions).toHaveLength(4);
  });

  it("leaving a busy page with unsaved edits is allowed; the edits come back and save when it is reopened", async () => {
    const { errors, srv, editor, chapter, queue, saver, session } = setup();
    await session.activate("A");
    editor.getState().apply(moveBox("t0", 4, 4));
    session.setBusy(new Set(["A"]));
    await session.activate("B");
    expect(errors).toEqual([]);
    expect(editor.getState().pageId).toBe("B");
    expect((await queue.get("A"))?.ops.length).toBeGreaterThan(0);
    // AI dịch xong trang A (version 2), trang hết bận.
    srv.A = { state: doc(2), version: 2 };
    session.setBusy(new Set());
    await session.activate("A");
    expect(editor.getState().doc?.text_boxes[0]).toMatchObject({ x: 4 });
    await saver.flush();
    expect(srv.A?.version).toBe(3);
    expect(srv.A?.state.text_boxes[0]).toMatchObject({ x: 4 });
    expect(chapter.getState().activePageId).toBe("A");
  });

  it("busy follows the active page and never hides a lock problem", async () => {
    const { editor, session } = setup();
    await session.activate("A");
    session.setBusy(new Set(["B"]));
    expect(editor.getState().readOnly).toBeNull();
    await session.activate("B");
    expect(editor.getState().readOnly).toBe("page_busy");
    await session.activate("A");
    expect(editor.getState().readOnly).toBeNull();
    editor.getState().setReadOnly("lock_denied");
    session.setBusy(new Set(["A"]));
    expect(editor.getState().readOnly).toBe("lock_denied");
    session.setBusy(new Set());
    expect(editor.getState().readOnly).toBe("lock_denied");
  });

  it("syncActive reloads a clean active page when the server version moved on (AI translated)", async () => {
    const { editor, chapter, session } = setup();
    await session.activate("A");
    chapter.getState().setStates([{ page_id: "A", state: doc(5), version: 4, ai_rev: 1, ai_update_available: false }]);
    session.syncActive();
    expect(editor.getState()).toMatchObject({ baseVersion: 4 });
    expect(editor.getState().doc?.regions).toHaveLength(5);
  });

  it("writes to a busy non-active page wait: restore is deferred, update is refused without a PUT", async () => {
    const { log, srv, queue, session } = setup();
    await session.activate("A");
    session.setBusy(new Set(["B"]));
    const local = doc(3);
    const first = local.text_boxes[0];
    if (first) first.x = 77;
    const rec = { pageId: "B", baseVersion: 1, ops: diffStates(doc(3), local), updatedAt: 1 };
    await queue.put(rec);
    log.length = 0;
    expect(await session.restoreOther(rec)).toBe("deferred");
    await expect(
      session.updateOther("B", (d) => {
        for (const b of d.text_boxes) b.align = "left";
      }),
    ).rejects.toThrow("đang dịch");
    expect(log.filter((l) => l.startsWith("put:"))).toEqual([]);
    expect(srv.B?.version).toBe(1);
    expect(await queue.get("B")).toBeDefined();
  });

  it("restoreOther rebases a pending record onto the cached state and PUTs it", async () => {
    const { srv, queue, session } = setup();
    const local = doc(3);
    const first = local.text_boxes[0];
    if (first) first.x = 99;
    const rec = { pageId: "B", baseVersion: 1, ops: diffStates(doc(3), local), updatedAt: 1 };
    await queue.put(rec);
    expect(await session.restoreOther(rec)).toBe("saved");
    expect(srv.B).toMatchObject({ version: 2 });
    expect(srv.B?.state.text_boxes[0]).toMatchObject({ x: 99 });
    expect(await queue.get("B")).toBeUndefined();
  });

  it("updateOther writes a non-active page (retrying once on 409) and refreshes its cache", async () => {
    const { srv, chapter, editor, session } = setup();
    await session.activate("A");
    // Cache của B cũ hơn server → PUT đầu 409, lấy lại rồi áp lại.
    srv.B = { state: srv.B?.state ?? doc(3), version: 2 };
    const ok = await session.updateOther("B", (d) => {
      for (const b of d.text_boxes) b.align = "left";
    });
    expect(ok).toBe(true);
    expect(srv.B?.version).toBe(3);
    expect(srv.B?.state.text_boxes.every((b) => b.align === "left")).toBe(true);
    expect(chapter.getState().cache.B?.version).toBe(3);
    expect(await session.updateOther("B", (d) => void d)).toBe(false);
    await expect(session.updateOther(editor.getState().pageId ?? "", () => {})).rejects.toThrow();
  });
});
