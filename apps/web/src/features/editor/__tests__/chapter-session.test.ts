import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { moveBox } from "../actions.ts";
import { createChapterStore } from "../chapter-store.ts";
import { batchOnTop } from "../history.ts";
import { PendingQueue } from "../pending-queue.ts";
import { diffStates, same } from "../rebase.ts";
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
  /** Các lượt đã ghi: state trước + (version, state) lượt đã ghi theo page — để giả `undoBatch` theo nội dung như server. */
  type S = ReturnType<typeof doc>;
  const batches: Record<string, { pre: Record<string, S>; wrote: Record<string, { version: number; state: S }> }> = {};
  let batchSeq = 0;
  const batchOf = (id: string) => {
    const b = batches[id];
    if (!b) throw new Error(`no batch ${id}`);
    return b;
  };
  const newBatch = () => {
    const id = `batch-${++batchSeq}`;
    batches[id] = { pre: {}, wrote: {} };
    return id;
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
    async putStates(list) {
      log.push(`putStates:${list.map((p) => p.page_id).join(",")}`);
      if (list.some((p) => srv[p.page_id]?.version !== p.version)) {
        throw Object.assign(new Error("409"), { status: 409 });
      }
      const versions: Record<string, number> = {};
      const id = newBatch();
      for (const p of list) {
        const prev = srv[p.page_id];
        if (prev) batchOf(id).pre[p.page_id] = structuredClone(prev.state);
        srv[p.page_id] = { state: structuredClone(p.state), version: p.version + 1 };
        batchOf(id).wrote[p.page_id] = { version: p.version + 1, state: structuredClone(p.state) };
        versions[p.page_id] = p.version + 1;
      }
      return { batch_id: id, versions };
    },
    queue,
    onError: (e) => {
      errors.push(e);
    },
  };
  chapter
    .getState()
    .setStates(Object.entries(srv).map(([page_id, v]) => ({ page_id, ...v, ai_rev: 0, ai_update_available: false })));
  chapter.getState().setPages(
    ["A", "B"].map((id, ord) => ({
      id,
      ord,
      width: 1000,
      height: 1000,
      status: "ready" as const,
      version: 1,
      clean_rev: 1,
      ai_update_available: false,
    })),
  );
  editor.getState().setReadOnly(null);
  /**
   * Giả `undoBatch(skip)` của server (page "đã sửa tiếp" = nội dung hiện tại khác nội dung lượt đã ghi) + việc màn chương làm
   * sau đó. `forceSkip`: ép server bỏ qua page (VD bản ghi lịch sử đã bị dọn).
   */
  const undoBatchServer = (batchId = "batch-1", forceSkip: string[] = []) => {
    const b = batches[batchId];
    if (!b) throw new Error(`no batch ${batchId}`);
    const skipped: string[] = [];
    const restored: string[] = [];
    for (const id of Object.keys(b.pre)) {
      const cur = srv[id];
      const w = b.wrote[id];
      const unchanged = !!cur && !!w && (cur.version === w.version || same(cur.state, w.state));
      (unchanged && !forceSkip.includes(id) ? restored : skipped).push(id);
    }
    // Như màn chương: onSuccess của hoàn tác (dọn mốc) chạy trước khi `refresh` đưa state mới vào cache.
    const local = session.afterBatchUndo(batchId, skipped, restored.length);
    for (const id of restored) {
      const cur = srv[id];
      const pre = b.pre[id];
      if (!cur || !pre) continue;
      srv[id] = { state: structuredClone(pre), version: cur.version + 1 };
      chapter.getState().setCached(id, { state: srv[id].state, version: srv[id].version });
    }
    session.syncActive();
    return { restored, skipped, local };
  };
  const session = new ChapterSession(deps);
  return { log, errors, srv, batchOf, newBatch, editor, chapter, saver, queue, session, undoBatchServer };
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

  it("edits kept from a busy page save on their own once it stops being busy, without reopening it", async () => {
    const { log, errors, srv, editor, queue, session } = setup();
    await session.activate("A");
    editor.getState().apply(moveBox("t0", 4, 4));
    session.setBusy(new Set(["A"]));
    await session.activate("B");
    // AI dịch xong trang A (version 2) trong lúc người dùng ở trang B.
    srv.A = { state: doc(2), version: 2 };
    log.length = 0;
    session.setBusy(new Set());
    await session.activate("B");
    expect(errors).toEqual([]);
    expect(log).toContain("put:A");
    expect(srv.A?.version).toBe(3);
    expect(srv.A?.state.text_boxes[0]).toMatchObject({ x: 4 });
    expect(await queue.get("A")).toBeUndefined();
    expect(editor.getState().pageId).toBe("B");
  });

  it("a save refused as page_busy while progress still shows the page free asks for fresh progress", async () => {
    const { editor, session } = setup();
    const recheck = vi.fn();
    const stop = session.watchSaverBusy(recheck);
    await session.activate("A");
    // Saver gặp 409 `page_busy` (lượt dịch mở từ nơi khác) → progress cũ chưa biết.
    editor.getState().setReadOnly("page_busy");
    expect(recheck).toHaveBeenCalledTimes(1);
    editor.getState().setReadOnly(null);
    // Progress đã biết trang bận → không hỏi lại.
    session.setBusy(new Set(["A"]));
    expect(editor.getState().readOnly).toBe("page_busy");
    expect(recheck).toHaveBeenCalledTimes(1);
    stop();
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

  it("syncActive keeps the selected block when it still exists in the newer version", async () => {
    const { editor, chapter, session } = setup();
    await session.activate("A");
    editor.getState().select("t1");
    chapter.getState().setStates([{ page_id: "A", state: doc(5), version: 4, ai_rev: 1, ai_update_available: false }]);
    session.syncActive();
    expect(editor.getState()).toMatchObject({ baseVersion: 4, selection: "t1" });
    editor.getState().select("gone");
    chapter.getState().setStates([{ page_id: "A", state: doc(5), version: 5, ai_rev: 1, ai_update_available: false }]);
    session.syncActive();
    expect(editor.getState().selection).toBeNull();
  });

  it("syncActive keeps the selected block without ever emitting an empty selection", async () => {
    const { editor, chapter, session } = setup();
    await session.activate("A");
    editor.getState().select("t1");
    const seen: (string | null)[] = [];
    editor.subscribe((s, prev) => {
      if (s.selection !== prev.selection) seen.push(s.selection);
    });
    chapter.getState().setStates([{ page_id: "A", state: doc(5), version: 4, ai_rev: 1, ai_update_available: false }]);
    session.syncActive();
    expect(editor.getState()).toMatchObject({ baseVersion: 4, selection: "t1" });
    expect(seen).toEqual([]);
  });

  it("refreshAi keeps the selected block when the background reload brings a newer version", async () => {
    const { editor, srv, session } = setup();
    await session.activate("A");
    editor.getState().select("t1");
    srv.A = { state: doc(5), version: 4 };
    await (session as unknown as { refreshAi(id: string): Promise<void> }).refreshAi("A");
    expect(editor.getState()).toMatchObject({ baseVersion: 4, selection: "t1" });
    editor.getState().select("gone");
    srv.A = { state: doc(5), version: 5 };
    await (session as unknown as { refreshAi(id: string): Promise<void> }).refreshAi("A");
    expect(editor.getState()).toMatchObject({ baseVersion: 5, selection: null });
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
    // Sửa hàng loạt bỏ qua page bận (chỉ ghi A).
    await session.editMany(() => (d) => {
      for (const b of d.text_boxes) b.align = "left";
    });
    expect(log.filter((l) => l.startsWith("put"))).toEqual(["putStates:A"]);
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

  it("editMany writes active + other pages in one batch, reloads the active page and refreshes the cache", async () => {
    const { log, srv, chapter, editor, session } = setup();
    await session.activate("A");
    editor.getState().apply(moveBox("t0", 7, 7));
    log.length = 0;
    const r = await session.editMany(() => (d) => {
      for (const b of d.text_boxes) b.align = "left";
    });
    expect(r).toEqual({ batchId: "batch-1", pageIds: ["A", "B"] });
    // Sửa đang chờ của A lưu trước (PUT riêng), rồi 1 lượt ghi cả hai page.
    expect(log.filter((l) => l.startsWith("put"))).toEqual(["put:A", "putStates:A,B"]);
    expect(srv.A).toMatchObject({ version: 3 });
    expect(srv.A?.state.text_boxes[0]).toMatchObject({ x: 7, align: "left" });
    expect(srv.B?.state.text_boxes.every((b) => b.align === "left")).toBe(true);
    expect(chapter.getState().cache.B?.version).toBe(2);
    // Page active nạp bản mới; Cmd+Z không tách lượt này ra từng page.
    expect(editor.getState()).toMatchObject({ baseVersion: 3 });
    expect(editor.getState().doc?.text_boxes.every((b) => b.align === "left")).toBe(true);
    // Lịch sử trước lượt giữ nguyên, thêm 1 mốc lượt ở cuối (không có patch).
    expect(editor.getState().history.past).toHaveLength(2);
    expect(batchOnTop(editor.getState().history)).toMatchObject({ id: "batch-1" });
  });

  it("editMany with nothing to change writes nothing", async () => {
    const { log, session } = setup();
    await session.activate("A");
    log.length = 0;
    expect(await session.editMany(() => null)).toBeNull();
    expect(await session.editMany(() => (d) => void d)).toBeNull();
    expect(log.filter((l) => l.startsWith("put"))).toEqual([]);
  });

  describe("bulk edit in the open page history", () => {
    const align = () => (d: { text_boxes: { align: string }[] }) => {
      for (const b of d.text_boxes) b.align = "left";
    };
    const applyBatch = async (t: ReturnType<typeof setup>) => {
      await t.session.activate("A");
      t.editor.getState().apply(moveBox("t0", 7, 7));
      await t.session.editMany(() => align() as never);
    };

    it("undoing the bulk edit keeps the earlier history so the next Cmd+Z undoes the earlier edit", async () => {
      const t = setup();
      await applyBatch(t);
      const { restored } = t.undoBatchServer();
      expect(restored).toEqual(["A", "B"]);
      const s = t.editor.getState();
      expect(s.doc?.text_boxes[0]).toMatchObject({ x: 7, align: "center" });
      // Mốc đã bị tiêu thụ: Cmd+Z kế tiếp là bước sửa trước lượt, không gọi lại lượt.
      expect(batchOnTop(s.history)).toBeNull();
      expect(s.history.past).toHaveLength(1);
      s.undo();
      expect(t.editor.getState().doc?.text_boxes[0]).toMatchObject({ x: 10 });
      t.editor.getState().redo();
      expect(t.editor.getState().doc?.text_boxes[0]).toMatchObject({ x: 7 });
    });

    it("keeps the earlier history when the cache update reloads the open page by itself (as the chapter screen does)", async () => {
      const t = setup();
      t.chapter.subscribe((s, prev) => s.cache !== prev.cache && t.session.syncActive());
      await applyBatch(t);
      expect(t.editor.getState().history.past).toHaveLength(2);
      t.undoBatchServer();
      t.editor.getState().undo();
      expect(t.editor.getState().doc?.text_boxes[0]).toMatchObject({ x: 10 });
    });

    it("an edit after the bulk edit is undone first; the mark stays below it", async () => {
      const t = setup();
      await applyBatch(t);
      t.editor.getState().apply(moveBox("t0", 40, 40));
      expect(batchOnTop(t.editor.getState().history)).toBeNull();
      t.editor.getState().undo();
      expect(batchOnTop(t.editor.getState().history)).toMatchObject({ id: "batch-1" });
    });

    it("edit then Cmd+Z the edit, then Cmd+Z the batch: the saves bumped the version but the content is the batch's, so the server restores it", async () => {
      const t = setup();
      await applyBatch(t);
      t.editor.getState().apply(moveBox("t0", 40, 40));
      await t.saver.flush();
      t.editor.getState().undo();
      await t.saver.flush();
      const { restored, skipped, local } = t.undoBatchServer();
      expect(restored).toEqual(["A", "B"]);
      expect(skipped).toEqual([]);
      expect(local).toBe(false);
      const s = t.editor.getState();
      expect(s.doc?.text_boxes[0]).toMatchObject({ x: 7, align: "center" });
      s.undo();
      expect(t.editor.getState().doc?.text_boxes[0]).toMatchObject({ x: 10 });
    });

    it("server still skipped the open page (history rows pruned) but restored others: the open page is restored in place", async () => {
      const t = setup();
      await applyBatch(t);
      t.editor.getState().apply(moveBox("t0", 40, 40));
      await t.saver.flush();
      t.editor.getState().undo();
      await t.saver.flush();
      const { restored, local } = t.undoBatchServer("batch-1", ["A"]);
      expect(restored).toEqual(["B"]);
      expect(local).toBe(true);
      await t.saver.flush();
      const s = t.editor.getState();
      expect(s.doc?.text_boxes[0]).toMatchObject({ x: 7, align: "center" });
      expect(t.srv.A?.state.text_boxes[0]).toMatchObject({ x: 7, align: "center" });
      expect(s.save.status).toBe("saved");
      s.undo();
      expect(t.editor.getState().doc?.text_boxes[0]).toMatchObject({ x: 10 });
    });

    it("never restores in place when the server restored nothing (the batch was undone elsewhere)", async () => {
      const t = setup();
      await applyBatch(t);
      const { restored, local } = t.undoBatchServer("batch-1", ["A", "B"]);
      expect(restored).toEqual([]);
      expect(local).toBe(false);
      expect(t.editor.getState().doc?.text_boxes[0]).toMatchObject({ align: "left" });
      expect(t.editor.getState().save.status).toBe("saved");
    });

    it("two bulk edits in a row undo one after the other and bring every page back", async () => {
      const t = setup();
      t.chapter.subscribe((s, prev) => s.cache !== prev.cache && t.session.syncActive());
      await t.session.activate("A");
      t.editor.getState().apply(moveBox("t0", 7, 7));
      await t.session.editMany(() => (d) => {
        for (const b of d.text_boxes) b.align = "left";
      });
      await t.session.editMany(() => (d) => {
        for (const b of d.text_boxes) b.align = "right";
      });
      expect(t.editor.getState().history.past).toHaveLength(3);
      const second = t.undoBatchServer("batch-2");
      expect(second.skipped).toEqual([]);
      expect(batchOnTop(t.editor.getState().history)).toMatchObject({ id: "batch-1" });
      const first = t.undoBatchServer("batch-1");
      expect(first.restored).toEqual(["A", "B"]);
      expect(first.skipped).toEqual([]);
      expect(t.srv.B?.state).toEqual(doc(3));
      expect(t.editor.getState().doc?.text_boxes[0]).toMatchObject({ x: 7, align: "center" });
      t.editor.getState().undo();
      expect(t.editor.getState().doc?.text_boxes[0]).toMatchObject({ x: 10 });
    });

    it("open page skipped because of a different edit keeps only the steps after the mark", async () => {
      const t = setup();
      await applyBatch(t);
      t.editor.getState().apply(moveBox("t0", 40, 40));
      await t.saver.flush();
      const { local, skipped } = t.undoBatchServer();
      expect(local).toBe(false);
      expect(skipped).toEqual(["A"]);
      const s = t.editor.getState();
      expect(s.doc?.text_boxes[0]).toMatchObject({ x: 40, align: "left" });
      expect(s.history.past).toHaveLength(1);
      s.undo();
      expect(t.editor.getState().doc?.text_boxes[0]).toMatchObject({ x: 7, align: "left" });
      expect(t.editor.getState().history.past).toHaveLength(0);
    });

    it("a batch that does not touch the open page only drops the mark", async () => {
      const t = setup();
      await t.session.activate("A");
      t.editor.getState().apply(moveBox("t0", 7, 7));
      await t.session.editMany((_st, id) => (id === "B" ? (align() as never) : null));
      expect(batchOnTop(t.editor.getState().history)).toMatchObject({ id: "batch-1" });
      t.undoBatchServer();
      expect(t.editor.getState().history.past).toHaveLength(1);
      expect(t.editor.getState().doc?.text_boxes[0]).toMatchObject({ x: 7 });
    });

    it("redo is cleared by the bulk edit, and a failed bulk write leaves the history untouched", async () => {
      const t = setup();
      await t.session.activate("A");
      t.editor.getState().apply(moveBox("t0", 7, 7));
      t.editor.getState().undo();
      expect(t.editor.getState().history.future).toHaveLength(1);
      t.srv.B = { state: doc(3), version: 9 };
      t.chapter.getState().setCached("B", { state: doc(3), version: 1 });
      await expect(t.session.editMany(() => align() as never)).rejects.toMatchObject({ status: 409 });
      expect(t.editor.getState().history.future).toHaveLength(1);
      expect(batchOnTop(t.editor.getState().history)).toBeNull();
    });

    it("the mark lives in the history of the page that was open: it is kept on return, absent on other pages", async () => {
      const t = setup();
      await applyBatch(t);
      await t.session.activate("B");
      expect(batchOnTop(t.editor.getState().history)).toBeNull();
      await t.session.activate("A");
      expect(batchOnTop(t.editor.getState().history)).toMatchObject({ id: "batch-1" });
    });

    it("undoing from another page (toast button) consumes the mark stored for the first page", async () => {
      const t = setup();
      await applyBatch(t);
      await t.session.activate("B");
      t.undoBatchServer();
      await t.session.activate("A");
      expect(batchOnTop(t.editor.getState().history)).toBeNull();
    });

    it("dropBatch (server refuses) removes the mark so Cmd+Z moves on", async () => {
      const t = setup();
      await applyBatch(t);
      t.session.dropBatch("batch-1");
      expect(batchOnTop(t.editor.getState().history)).toBeNull();
    });
  });

  describe("bulk edit applied on the server (find/replace, glossary)", () => {
    /** Giả server áp lượt lên page `ids` rồi màn chương tải lại state vào cache (kích hoạt nạp lại page đang mở). */
    const serverApply = (t: ReturnType<typeof setup>, ids: string[]) => {
      const versions: Record<string, number> = {};
      const batchId = t.newBatch();
      for (const id of ids) {
        const cur = t.srv[id];
        if (!cur) continue;
        t.batchOf(batchId).pre[id] = structuredClone(cur.state);
        const next = structuredClone(cur.state);
        for (const b of next.text_boxes) b.align = "left";
        t.srv[id] = { state: next, version: cur.version + 1 };
        t.batchOf(batchId).wrote[id] = { version: cur.version + 1, state: structuredClone(next) };
        versions[id] = cur.version + 1;
      }
      const refresh = () => {
        for (const id of ids) {
          const e = t.srv[id];
          if (e) t.chapter.getState().setCached(id, { state: e.state, version: e.version });
        }
      };
      return { batchId, versions, refresh };
    };
    const open = async (t: ReturnType<typeof setup>) => {
      t.chapter.subscribe((s, prev) => s.cache !== prev.cache && t.session.syncActive());
      await t.session.activate("A");
      t.editor.getState().apply(moveBox("t0", 7, 7));
      await t.saver.flush();
    };

    it("keeps the earlier history across the reload and puts the mark last; undo then steps back the earlier edit", async () => {
      const t = setup();
      await open(t);
      const a = serverApply(t, ["A", "B"]);
      t.session.recordServerBatch(a.batchId, a.versions);
      a.refresh();
      const s = t.editor.getState();
      expect(s.doc?.text_boxes[0]).toMatchObject({ align: "left" });
      expect(s.history.past).toHaveLength(2);
      expect(batchOnTop(s.history)).toMatchObject({ id: "batch-1" });
      t.undoBatchServer();
      expect(batchOnTop(t.editor.getState().history)).toBeNull();
      t.editor.getState().undo();
      expect(t.editor.getState().doc?.text_boxes[0]).toMatchObject({ x: 10 });
    });

    it("edit after the batch, then Cmd+Z the edit, then the batch: restored in place", async () => {
      const t = setup();
      await open(t);
      const a = serverApply(t, ["A", "B"]);
      t.session.recordServerBatch(a.batchId, a.versions);
      a.refresh();
      t.editor.getState().apply(moveBox("t0", 40, 40));
      await t.saver.flush();
      t.editor.getState().undo();
      await t.saver.flush();
      const { local } = t.undoBatchServer("batch-1", ["A"]);
      expect(local).toBe(true);
      expect(t.editor.getState().doc?.text_boxes[0]).toMatchObject({ x: 7, align: "center" });
    });

    it("a batch not applied right on the editor's base (an AI update slipped in) is not marked: the history is dropped on reload as before", async () => {
      const t = setup();
      await open(t);
      // Server ghi 1 bản (AI) mà editor chưa nạp; rồi lượt áp lên bản đó → version lượt = base + 2.
      const cur = t.srv.A;
      if (cur) t.srv.A = { state: cur.state, version: cur.version + 1 };
      const a = serverApply(t, ["A"]);
      t.session.recordServerBatch(a.batchId, a.versions);
      a.refresh();
      expect(t.editor.getState().doc?.text_boxes[0]).toMatchObject({ align: "left" });
      expect(t.editor.getState().history.past).toHaveLength(0);
    });

    it("a batch that skips the open page only adds a mark that does not touch the history", async () => {
      const t = setup();
      await open(t);
      const a = serverApply(t, ["B"]);
      t.session.recordServerBatch(a.batchId, a.versions);
      a.refresh();
      expect(t.editor.getState().history.past).toHaveLength(2);
      expect(t.editor.getState().doc?.text_boxes[0]).toMatchObject({ x: 7, align: "center" });
      t.undoBatchServer();
      expect(t.editor.getState().history.past).toHaveLength(1);
    });

    it("without per-page versions (older server) or with unsaved edits nothing is marked", async () => {
      const t = setup();
      await open(t);
      t.session.recordServerBatch("batch-1", undefined);
      expect(t.editor.getState().history.past).toHaveLength(1);
      t.editor.getState().apply(moveBox("t0", 9, 9));
      t.session.recordServerBatch("batch-2", { A: 5 });
      expect(t.editor.getState().history.past).toHaveLength(2);
      expect(batchOnTop(t.editor.getState().history)).toBeNull();
    });
  });
});
