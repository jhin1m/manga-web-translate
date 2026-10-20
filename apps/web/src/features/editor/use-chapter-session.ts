/**
 * Phiên sửa cả chương (màn chương gộp): 1 page "active" nằm trong `editorStore` (sửa/undo/autosave như editor
 * 1 page cũ), các page khác chỉ đọc từ `chapterStore.cache`. Ghép: font, Saver (IndexedDB → PUT If-Match), khoá
 * chương theo trạng thái, khôi phục thay đổi chưa lưu nhiều page, đổi page active và chạy thao tác AI.
 *
 * Chính sách khoá: chỉ giữ khoá khi chương ổn định (review/partial_failed/done) và có page. Đang dịch/xử lý →
 * editor read-only "processing" và KHÔNG giữ khoá: AI chỉ ghi `state` khi chương không bị khoá
 * (apps/api/src/jobs/page-state-writer.ts) — giữ khoá thì lần dịch đầu chỉ hiện cờ "AI có bản mới".
 */
import { emptyPageState, type PageState } from "@mtl/shared";
import { type Draft, produce } from "immer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { lockChapter, unlockChapter } from "../chapter/api.ts";
import { serial, useChapterLock } from "../chapter/use-chapter-lock.ts";
import { fetchPageDetail, type PageDetail, putPageState } from "./api.ts";
import { type ChapterStore, chapterStore } from "./chapter-store.ts";
import { type FontKit, loadFonts } from "./fonts.ts";
import type { History } from "./history.ts";
import { PendingQueue, type PendingRecord } from "./pending-queue.ts";
import { rebase, same } from "./rebase.ts";
import { finalSave, Saver } from "./save.ts";
import { type AiInfo, type EditorStore, editorStore } from "./store.ts";

export type LoadedPage = { state: PageState; version: number; ai: AiInfo };

export type SessionDeps = {
  editor: EditorStore;
  chapter: ChapterStore;
  saver: Pick<Saver, "flush" | "persist" | "schedule">;
  /** GET /pages/:id (state + version + ai_state). */
  fetchPage(pageId: string): Promise<LoadedPage>;
  putState(pageId: string, state: PageState, version: number): Promise<{ version: number }>;
  unlock(): Promise<unknown>;
  queue: Pick<PendingQueue, "delete">;
  onPause(paused: boolean): void;
  onError(e: unknown): void;
};

const statusOf = (e: unknown) =>
  e && typeof e === "object" && "status" in e && typeof e.status === "number" ? e.status : 0;

/** Page đang sửa còn thay đổi chưa lưu được → không đổi page (sửa vẫn nằm trong editor + IndexedDB). */
export class UnsavedPageError extends Error {
  constructor(ord: number | undefined) {
    super(
      `Chưa lưu được trang ${ord === undefined ? "đang sửa" : ord + 1} — ở lại trang này tới khi lưu xong (thử lại sau).`,
    );
  }
}

/** Thao tác thuần trên store (không React) — test được với store + Saver giả. */
export class ChapterSession {
  /** Lịch sử undo đã cất theo page (dùng lại khi quay về page mà version không đổi). */
  private stash = new Map<string, { version: number; history: History }>();
  /** Bản ghi khôi phục có xung đột của page không active → áp khi mở page đó (hiện danh sách xung đột). */
  private deferred = new Map<string, PendingRecord>();
  private chain: Promise<void> = Promise.resolve();
  private target: string | null = null;

  constructor(private readonly deps: SessionDeps) {}

  /**
   * Đổi page active. Tuần tự (promise chain) và chỉ lấy yêu cầu cuối khi bấm nhanh nhiều page: lưu page cũ
   * (`flush`) → cất lịch sử + ghi cache từ base đã lưu → `load` page mới.
   */
  activate(pageId: string): Promise<void> {
    this.target = pageId;
    this.chain = this.chain
      .then(() => (this.target === pageId ? this.doActivate(pageId) : undefined))
      .catch((e: unknown) => this.deps.onError(e));
    return this.chain;
  }

  private async doActivate(pageId: string) {
    const { editor, chapter, saver } = this.deps;
    if (editor.getState().pageId === pageId) {
      chapter.getState().setActive(pageId);
      return;
    }
    // Lấy dữ liệu page đích TRƯỚC (có thể phải gọi mạng), để từ lúc kiểm "đã lưu" tới lúc `load` không có await
    // nào — sửa trên page cũ trong lúc chờ không bị bỏ.
    const entry = chapter.getState().cache[pageId];
    const meta = chapter.getState().pages.find((p) => p.id === pageId);
    let loaded: LoadedPage;
    let fresh = false;
    if (entry && (entry.state || meta)) {
      loaded = {
        state: entry.state ?? emptyPageState(meta?.width ?? 1, meta?.height ?? 1),
        version: entry.version,
        ai: { state: null, rev: entry.ai_rev, available: entry.ai_update_available },
      };
    } else {
      loaded = await this.deps.fetchPage(pageId);
      fresh = true;
    }
    // Sửa trong lúc PUT đang bay → lưu tiếp (tối đa vài lượt).
    for (let i = 0; i < 3; i++) {
      const s = editor.getState();
      if (!s.pageId || s.doc === s.base) break;
      await saver.flush();
    }
    if (this.target !== pageId) return;
    const prev = editor.getState();
    if (prev.pageId && prev.doc !== prev.base) {
      // Không lưu được (mất khoá, lỗi mạng): ở lại page này — đổi page sẽ bỏ sửa khỏi editor.
      await saver.persist();
      throw new UnsavedPageError(chapter.getState().pages.find((p) => p.id === prev.pageId)?.ord);
    }
    if (prev.pageId && prev.base) {
      this.stash.set(prev.pageId, { version: prev.baseVersion, history: prev.history });
      chapter.getState().setCached(prev.pageId, {
        state: prev.base,
        version: prev.baseVersion,
        ai_rev: prev.ai.rev,
        ai_update_available: prev.ai.available,
      });
    }
    // Cache có thể vừa có version mới hơn (AI/tìm & thay) trong lúc chờ lưu.
    const latest = chapter.getState().cache[pageId];
    if (!fresh && latest?.state && latest.version > loaded.version) {
      loaded = { ...loaded, state: latest.state, version: latest.version };
    }
    const st = this.stash.get(pageId);
    editor.getState().load({
      pageId,
      ...loaded,
      history: st && st.version === loaded.version ? st.history : undefined,
    });
    chapter.getState().setActive(pageId);
    this.applyDeferred(pageId);
    // ai_state không có trong cache (GET /states không trả) → lấy nền cho "Về bản AI"/bảng AI có bản mới.
    if (!fresh) void this.refreshAi(pageId);
  }

  private async refreshAi(pageId: string) {
    try {
      const d = await this.deps.fetchPage(pageId);
      const s = this.deps.editor.getState();
      if (s.pageId !== pageId) return;
      if (d.version > s.baseVersion && s.doc === s.base) s.load({ pageId, ...d });
      else s.setAi(d.ai);
    } catch (e) {
      this.deps.onError(e);
    }
  }

  /**
   * Cache của page active có version mới hơn (AI vừa dịch xong, tìm & thay ở server…) mà người dùng chưa sửa gì
   * → nạp lại. Đang có sửa chưa lưu thì để Saver gặp 409 và rebase như thường.
   */
  syncActive() {
    const s = this.deps.editor.getState();
    if (!s.pageId) return;
    const c = this.deps.chapter.getState().cache[s.pageId];
    if (!c?.state || c.version <= s.baseVersion || s.doc !== s.base || s.save.status !== "saved") return;
    s.load({ pageId: s.pageId, state: c.state, version: c.version, ai: { ...s.ai, available: c.ai_update_available } });
    void this.refreshAi(s.pageId);
  }

  /**
   * Thao tác cho AI chạy (Dịch chương, Dịch lại, Chạy lại trang lỗi): lưu xong → tạm dừng giữ khoá → nhả khoá
   * (cùng chuỗi lock/unlock của tab) → gọi API. Khoá giữ lại khi chương ổn định trở lại (caller theo dõi).
   */
  async runAi<T>(fn: () => Promise<T>): Promise<T> {
    await this.deps.saver.flush();
    this.deps.onPause(true);
    try {
      await serial(() => this.deps.unlock()).catch(() => undefined);
      return await fn();
    } catch (e) {
      this.deps.onPause(false);
      throw e;
    }
  }

  /**
   * Khôi phục bản ghi IndexedDB của page KHÔNG active: rebase op lên state server rồi PUT thẳng. Có xung đột →
   * hoãn tới khi mở page đó (danh sách xung đột hiện trong inspector).
   */
  async restoreOther(rec: PendingRecord): Promise<"saved" | "deferred" | "noop"> {
    const { chapter, queue } = this.deps;
    const c = chapter.getState().cache[rec.pageId];
    let server = c?.state ? { state: c.state, version: c.version } : await this.deps.fetchPage(rec.pageId);
    for (let round = 0; ; round++) {
      const r = rebase(server.state, rec.ops);
      if (r.conflicts.length) {
        this.deferred.set(rec.pageId, rec);
        return "deferred";
      }
      if (same(r.state, server.state)) {
        await queue.delete(rec.pageId);
        return "noop";
      }
      try {
        const { version } = await this.deps.putState(rec.pageId, r.state, server.version);
        chapter.getState().setCached(rec.pageId, { state: r.state, version });
        await queue.delete(rec.pageId);
        return "saved";
      } catch (e) {
        if (statusOf(e) !== 409 || round > 0) throw e;
        server = await this.deps.fetchPage(rec.pageId);
      }
    }
  }

  /**
   * Ghi 1 thay đổi thẳng lên page KHÔNG active (VD áp kiểu cho khối cùng loại cả chương): áp `recipe` lên state
   * cache (chưa có thì lấy server) → PUT If-Match → cập nhật cache; 409 → lấy bản mới, áp lại 1 lần.
   * Trả false khi không có gì đổi. Không có undo (ngoài page active).
   */
  async updateOther(pageId: string, recipe: (draft: Draft<PageState>) => void): Promise<boolean> {
    const { chapter, editor } = this.deps;
    if (editor.getState().pageId === pageId) throw new Error("page đang sửa — dùng editor.apply");
    const c = chapter.getState().cache[pageId];
    let server = c?.state ? { state: c.state, version: c.version } : await this.deps.fetchPage(pageId);
    for (let round = 0; ; round++) {
      const next = produce(server.state, recipe);
      if (next === server.state) return false;
      try {
        const { version } = await this.deps.putState(pageId, next, server.version);
        chapter.getState().setCached(pageId, { state: next, version });
        return true;
      } catch (e) {
        if (statusOf(e) !== 409 || round > 0) throw e;
        server = await this.deps.fetchPage(pageId);
      }
    }
  }

  /** Khôi phục bản ghi của page active vào editor (rebase lên base hiện tại; xung đột liệt kê). */
  restoreActive(rec: PendingRecord) {
    const s = this.deps.editor.getState();
    if (!s.base || s.pageId !== rec.pageId) return;
    const r = rebase(s.base, rec.ops);
    // Bản ghi cũ đã có trên server (crash sau khi PUT thành công) → không ghi lại bản trùng.
    if (r.conflicts.length === 0 && same(r.state, s.base)) {
      void this.deps.queue.delete(rec.pageId);
      return;
    }
    s.rebased(s.base, s.baseVersion, r.state, r.conflicts);
    this.deps.saver.schedule();
  }

  private applyDeferred(pageId: string) {
    const rec = this.deferred.get(pageId);
    if (!rec) return;
    this.deferred.delete(pageId);
    this.restoreActive(rec);
  }
}

/** 1 kết nối IndexedDB mỗi tab, mở khi cần (module được import cả trong test không có IndexedDB). */
let sharedQueue: PendingQueue | null = null;
const pendingQueue = () => {
  sharedQueue ??= new PendingQueue();
  return sharedQueue;
};

const stateOf = (d: PageDetail) => d.state ?? emptyPageState(d.page.width, d.page.height);
const loadedOf = (d: PageDetail): LoadedPage => ({
  state: stateOf(d),
  version: d.version,
  ai: { state: d.ai_state, rev: d.ai_rev, available: d.ai_update_available },
});

function useFontKit() {
  const [kit, setKit] = useState<FontKit | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadFonts()
      .then((k) => {
        if (!live) return;
        setKit(k);
        editorStore.getState().setLayout(k.layout);
      })
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, []);
  return { kit, error };
}

export type RecoveryItem = PendingRecord & { ord: number };

/** Saver của phiên đang mở (store dùng chung cả tab → tối đa 1 phiên sống). */
let activeSaver: Saver | null = null;

/**
 * Hook React quanh `ChapterSession`. `settled` = chương ổn định (không còn job), `pageIds` theo ord,
 * `refetchProgress` trả trạng thái chương mới.
 */
export function useChapterSession(opts: {
  ws: string;
  chapterId: string;
  settled: boolean;
  pageIds: string[];
  refetchProgress(): Promise<boolean | undefined>;
}) {
  const { ws, chapterId, settled, pageIds } = opts;
  // Store dùng chung cả tab: phiên mới bắt đầu sạch (chạy trước mọi effect con). Đổi thẳng từ chương khác
  // (back/forward) thì phiên cũ chưa kịp cleanup → giao sửa chưa lưu của nó cho Saver cũ lưu trước khi reset.
  useState(() => {
    activeSaver?.flushDetached();
    editorStore.getState().reset();
    chapterStore.getState().reset(chapterId);
  });
  const { kit, error: fontError } = useFontKit();
  const queue = pendingQueue();
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  const saver = useMemo(
    () =>
      new Saver(
        editorStore,
        {
          put: (id, state, version) => putPageState(ws, id, state, version),
          get: async (id) => loadedOf(await fetchPageDetail(ws, id)),
        },
        queue,
      ),
    [ws, queue],
  );
  const session = useMemo(
    () =>
      new ChapterSession({
        editor: editorStore,
        chapter: chapterStore,
        saver,
        fetchPage: async (id) => loadedOf(await fetchPageDetail(ws, id)),
        putState: (id, state, version) => putPageState(ws, id, state, version),
        unlock: () => unlockChapter(ws, chapterId),
        queue,
        onPause: setPaused,
        onError: (e) => setError(errorMessage(e)),
      }),
    [ws, chapterId, saver, queue],
  );

  // Mọi thay đổi doc → lưu nháp IndexedDB + autosave. Phải khai báo TRƯỚC useChapterLock (thứ tự cleanup).
  useEffect(() => {
    saver.start();
    activeSaver = saver;
    const unsub = editorStore.subscribe((s, prev) => {
      if (s.doc !== prev.doc && s.doc !== s.base && s.pageId === prev.pageId) saver.schedule();
    });
    const flush = () => void saver.flush();
    const onHide = () => {
      void saver.persist();
      flush();
    };
    const onVisibility = () => document.visibilityState === "hidden" && onHide();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (editorStore.getState().save.status !== "saved") e.preventDefault();
    };
    addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    addEventListener("beforeunload", onBeforeUnload);
    return () => {
      unsub();
      removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      removeEventListener("beforeunload", onBeforeUnload);
      saver.dispose();
      if (activeSaver === saver) activeSaver = null;
      // Cleanup này chạy TRƯỚC cleanup của useChapterLock (khai báo trước) → lượt lưu cuối vào chuỗi khoá trước
      // lệnh nhả khoá.
      void serial(() => finalSave(saver, editorStore, () => lockChapter(ws, chapterId)));
    };
  }, [saver, ws, chapterId]);

  const lockEnabled = settled && pageIds.length > 0 && !paused;
  const lock = useChapterLock(ws, chapterId, lockEnabled);
  const [recovery, setRecovery] = useState<RecoveryItem[] | null>(null);
  /** Đã quét IndexedDB xong — trước đó chưa cho sửa (sửa sẽ ghi đè bản ghi đang chờ khôi phục). */
  const [scanDone, setScanDone] = useState(false);
  /**
   * `lock.state` lúc khoá bị tắt (đang dịch / tạm dừng cho AI): bật lại thì object cũ vẫn báo "held" cho tới khi
   * hook khoá chạy lại → không coi là đang giữ khoá (lưu lúc đó sẽ 423).
   */
  const lockAtDisable = useRef<unknown>(null);

  // Khoá chương ↔ read-only. Phụ thuộc cả object state: mỗi heartbeat thành công là object mới, nên sau
  // `lock_lost` (PUT 423) lần lấy lại khoá kế tiếp mở lại quyền sửa và lưu tiếp phần đang chờ.
  useEffect(() => {
    const s = editorStore.getState();
    if (!lockEnabled) {
      lockAtDisable.current = lock.state;
      if (s.readOnly !== "processing") s.setReadOnly("processing");
      return;
    }
    const st = lock.state === lockAtDisable.current ? "acquiring" : lock.state.status;
    if (st === "held") {
      const stale = ["loading", "lock_denied", "lock_lost", "processing", "recovery"] as const;
      if (!scanDone) {
        if (s.readOnly === null || s.readOnly === "processing") s.setReadOnly("loading");
      } else if (stale.some((r) => r === s.readOnly)) {
        s.setReadOnly(recovery ? "recovery" : null);
        void saver.flush();
      }
    } else if (st === "acquiring") {
      if (s.readOnly === null || s.readOnly === "processing") s.setReadOnly("loading");
    } else s.setReadOnly("lock_denied");
  }, [lock.state, lockEnabled, recovery, saver, scanDone]);

  // PUT trả 423 → thử lấy lại khoá ngay (thành công thì effect trên mở lại quyền sửa).
  const retryLock = lock.retry;
  useEffect(
    () =>
      editorStore.subscribe((s, prev) => {
        if (s.readOnly === "lock_lost" && prev.readOnly !== "lock_lost") void retryLock();
      }),
    [retryLock],
  );

  // Quét khôi phục 1 lần khi biết danh sách page: 1 thông báo cho mọi page còn thay đổi chưa lưu.
  const scanned = useRef(false);
  const idsKey = pageIds.join(",");
  useEffect(() => {
    if (scanned.current || !idsKey) return;
    scanned.current = true;
    const ids = idsKey.split(",");
    queue
      .getMany(ids)
      .then((recs) => {
        const items = recs.filter((r) => r.ops.length > 0).map((r) => ({ ...r, ord: ids.indexOf(r.pageId) }));
        if (items.length) setRecovery(items.sort((a, b) => a.ord - b.ord));
      })
      .catch((e: unknown) => console.warn("[editor] không đọc được bản nháp IndexedDB", e))
      .finally(() => setScanDone(true));
  }, [idsKey, queue]);

  const restore = useCallback(
    async (accept: boolean) => {
      const recs = recovery ?? [];
      setRecovery(null);
      if (!accept) {
        await Promise.all(recs.map((r) => queue.delete(r.pageId)));
        return;
      }
      for (const r of recs) {
        try {
          if (r.pageId === editorStore.getState().pageId) session.restoreActive(r);
          else await session.restoreOther(r);
        } catch (e) {
          setError(`Khôi phục trang ${r.ord + 1} lỗi: ${errorMessage(e)}`);
        }
      }
    },
    [recovery, session, queue],
  );

  // Tạm dừng khoá cho AI: mở lại khi chương rời trạng thái ổn định rồi quay về (hoặc không có gì chạy).
  const left = useRef(false);
  useEffect(() => {
    if (!paused) return;
    if (!settled) left.current = true;
    else if (left.current) {
      left.current = false;
      setPaused(false);
    }
  }, [paused, settled]);
  const { refetchProgress } = opts;
  const runAi = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T> => {
      left.current = false;
      const out = await session.runAi(fn);
      const nowSettled = await refetchProgress().catch(() => true);
      if (nowSettled && !left.current) setPaused(false);
      return out;
    },
    [session, refetchProgress],
  );

  return {
    kit,
    fontError,
    error,
    setError,
    saver,
    session,
    lock,
    lockEnabled,
    paused,
    recovery,
    restore,
    runAi,
  };
}
