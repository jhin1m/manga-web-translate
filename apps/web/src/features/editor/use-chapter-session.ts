/**
 * Phiên sửa cả chương (màn chương gộp): 1 page "active" nằm trong `editorStore` (sửa/undo/autosave như editor
 * 1 page cũ), các page khác chỉ đọc từ `chapterStore.cache`. Ghép: font, Saver (IndexedDB → PUT If-Match), khoá
 * chương theo trạng thái, khôi phục thay đổi chưa lưu nhiều page, đổi page active và chạy thao tác AI.
 *
 * Chính sách khoá: giữ khoá khi chương có page và không còn đang cắt trang (`lockable`) — cả lúc đang dịch. AI vẫn
 * ghi `state` của trang chưa sửa tay dù chương đang khoá (apps/api/src/jobs/page-state-writer.ts); trang đang dịch /
 * chờ lượt là trang bận → read-only "page_busy" (server cũng trả 409 `page_busy`), trang đã xong sửa bình thường.
 */
import { emptyPageState, type PageState } from "@mtl/shared";
import { useQueryClient } from "@tanstack/react-query";
import { type Draft, produce } from "immer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { lockChapter } from "../chapter/api.ts";
import { serial, useChapterLock } from "../chapter/use-chapter-lock.ts";
import { fetchFonts, fontKeys } from "../fonts/api.ts";
import { fetchPageDetail, type PageDetail, putPageState } from "./api.ts";
import { type ChapterStore, chapterStore } from "./chapter-store.ts";
import { type FontKit, loadFonts } from "./fonts.ts";
import type { History } from "./history.ts";
import { PendingQueue, type PendingRecord } from "./pending-queue.ts";
import { diffStates, rebase, same } from "./rebase.ts";
import { finalSave, isPageBusyError, Saver } from "./save.ts";
import { type AiInfo, type EditorStore, editorStore } from "./store.ts";

export type LoadedPage = { state: PageState; version: number; ai: AiInfo };

export type SessionDeps = {
  editor: EditorStore;
  chapter: ChapterStore;
  saver: Pick<Saver, "flush" | "persist" | "schedule">;
  /** GET /pages/:id (state + version + ai_state). */
  fetchPage(pageId: string): Promise<LoadedPage>;
  putState(pageId: string, state: PageState, version: number): Promise<{ version: number }>;
  queue: Pick<PendingQueue, "delete">;
  onError(e: unknown): void;
};

const statusOf = (e: unknown) =>
  e && typeof e === "object" && "status" in e && typeof e.status === "number" ? e.status : 0;

const PAGE_BUSY_TEXT = "trang đang dịch — sửa được khi xong";

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
  /** Page đang dịch / chờ lượt dịch (theo progress) → page active trong đó chỉ xem. */
  private busy: ReadonlySet<string> = new Set();

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
    const keptEdits = !!prev.pageId && prev.doc !== prev.base;
    if (prev.pageId && prev.doc !== prev.base) {
      await saver.persist();
      // Page đang dịch: chưa lưu được tới khi lô của nó xong → cất phần sửa, mở lại page thì rebase + lưu tiếp.
      if (prev.readOnly === "page_busy" && prev.base && prev.doc) {
        this.deferred.set(prev.pageId, {
          pageId: prev.pageId,
          baseVersion: prev.baseVersion,
          ops: diffStates(prev.base, prev.doc),
          updatedAt: Date.now(),
        });
      } else {
        // Không lưu được (mất khoá, lỗi mạng): ở lại page này — đổi page sẽ bỏ sửa khỏi editor.
        throw new UnsavedPageError(chapter.getState().pages.find((p) => p.id === prev.pageId)?.ord);
      }
    }
    if (prev.pageId && prev.base) {
      // Phần sửa cất riêng (page bận) sẽ rebase lại khi mở → lịch sử undo cũ không còn khớp, bỏ.
      if (keptEdits) this.stash.delete(prev.pageId);
      else this.stash.set(prev.pageId, { version: prev.baseVersion, history: prev.history });
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
    this.applyBusy();
    this.applyDeferred(pageId);
    // ai_state không có trong cache (GET /states không trả) → lấy nền cho "Bỏ chỉnh sửa tay"/bảng AI có bản mới.
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
   * Cập nhật tập page bận và read-only của page active: vào bận → "page_busy" (chỉ khi đang sửa được — không che lý
   * do khoá/khôi phục/đang tải); hết bận → mở sửa, nạp bản AI nếu chưa sửa gì và lưu phần còn chờ (409 → rebase).
   * Page khác vừa hết bận mà còn phần sửa đã cất → lưu luôn, không đợi mở lại page đó.
   */
  setBusy(ids: ReadonlySet<string>) {
    const was = this.busy;
    this.busy = ids;
    this.applyBusy();
    const active = this.deps.editor.getState().pageId;
    for (const [id, rec] of this.deferred) {
      if (id === active || !was.has(id) || ids.has(id)) continue;
      this.deferred.delete(id);
      this.saveDeferred(rec);
    }
  }

  /** Lưu phần sửa đã cất của page không active (sau lần đổi page đang chờ, để mở page đó thấy bản đã lưu). */
  private saveDeferred(rec: PendingRecord) {
    this.chain = this.chain
      .then(() => this.restoreOther(rec))
      .then(
        () => undefined,
        (e: unknown) => {
          // Không lưu được: giữ lại để mở page đó thì áp vào editor (IndexedDB vẫn còn bản ghi).
          if (!this.deferred.has(rec.pageId)) this.deferred.set(rec.pageId, rec);
          this.deps.onError(e);
        },
      );
  }

  /**
   * Saver gặp 409 `page_busy` cho page active mà progress chưa coi là bận (lượt dịch mở từ tab khác, hay lô vừa
   * chạy giữa 2 lần poll) → gọi `recheck` để lấy progress mới; tập bận mới sẽ gỡ hoặc giữ read-only.
   */
  watchSaverBusy(recheck: () => void): () => void {
    return this.deps.editor.subscribe((s, prev) => {
      if (s.readOnly !== "page_busy" || prev.readOnly === "page_busy" || !s.pageId) return;
      if (!this.busy.has(s.pageId)) recheck();
    });
  }

  private applyBusy() {
    const s = this.deps.editor.getState();
    const busy = s.pageId !== null && this.busy.has(s.pageId);
    if (busy && s.readOnly === null) s.setReadOnly("page_busy");
    else if (!busy && s.readOnly === "page_busy") {
      s.setReadOnly(null);
      this.syncActive();
      void this.deps.saver.flush();
    }
  }

  /**
   * Thao tác cho AI chạy (Dịch chương, Dịch lại, Chạy lại trang lỗi): lưu xong rồi gọi API. Giữ nguyên khoá — trang
   * vào lượt dịch thành trang bận (read-only) theo progress.
   */
  async runAi<T>(fn: () => Promise<T>): Promise<T> {
    await this.deps.saver.flush();
    return fn();
  }

  /**
   * Khôi phục bản ghi IndexedDB của page KHÔNG active: rebase op lên state server rồi PUT thẳng. Có xung đột, hoặc
   * page đang dịch (server trả 409 `page_busy`) → hoãn tới khi mở page đó (xung đột hiện trong panel Chọn; page bận
   * lưu khi lô của nó xong).
   */
  async restoreOther(rec: PendingRecord): Promise<"saved" | "deferred" | "noop"> {
    const { chapter, queue } = this.deps;
    if (this.busy.has(rec.pageId)) {
      this.deferred.set(rec.pageId, rec);
      return "deferred";
    }
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
        if (isPageBusyError(e)) {
          this.deferred.set(rec.pageId, rec);
          return "deferred";
        }
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
    if (this.busy.has(pageId)) throw new Error(PAGE_BUSY_TEXT);
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
        if (isPageBusyError(e)) throw new Error(PAGE_BUSY_TEXT);
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

/** Font gói sẵn + font riêng (danh sách lấy tươi mỗi phiên để URL presigned còn hạn). */
function useFontKit() {
  const qc = useQueryClient();
  const [kit, setKit] = useState<FontKit | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadFonts(() => qc.fetchQuery({ queryKey: fontKeys.list(), queryFn: () => fetchFonts(), staleTime: 0 }))
      .then((k) => {
        if (!live) return;
        setKit(k);
        editorStore.getState().setLayout(k.layout);
      })
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [qc]);
  return { kit, error };
}

export type RecoveryItem = PendingRecord & { ord: number };

/** Saver của phiên đang mở (store dùng chung cả tab → tối đa 1 phiên sống). */
let activeSaver: Saver | null = null;

/**
 * Bắt đầu phiên chương mới trên store dùng chung cả tab — gọi TRƯỚC khi render cây dùng `useChapterSession`.
 * Đổi thẳng từ chương khác (back/forward) thì cleanup của phiên cũ chưa chạy → giao sửa chưa lưu của nó cho Saver cũ
 * lưu trước khi reset.
 */
export function resetChapterSession(chapterId: string) {
  activeSaver?.flushDetached();
  editorStore.getState().reset();
  chapterStore.getState().reset(chapterId);
}

/**
 * Hook React quanh `ChapterSession`. `lockable` = chương đã có page và không còn cắt trang (giữ khoá cả lúc đang dịch),
 * `pageIds` theo ord, `busyPageIds` = page đang xử lý / chờ lượt dịch (chỉ xem), `refetchProgress` làm mới tiến độ
 * ngay sau khi gọi AI. Store phải được `resetChapterSession` trước lần render đầu.
 */
export function useChapterSession(opts: {
  chapterId: string;
  lockable: boolean;
  pageIds: string[];
  busyPageIds: ReadonlySet<string>;
  refetchProgress(): Promise<boolean | undefined>;
}) {
  const { chapterId, lockable, pageIds, busyPageIds } = opts;
  const { kit, error: fontError } = useFontKit();
  const queue = pendingQueue();
  const [error, setError] = useState<string | null>(null);

  const saver = useMemo(
    () =>
      new Saver(
        editorStore,
        {
          put: (id, state, version) => putPageState(id, state, version),
          get: async (id) => loadedOf(await fetchPageDetail(id)),
        },
        queue,
      ),
    [queue],
  );
  const session = useMemo(
    () =>
      new ChapterSession({
        editor: editorStore,
        chapter: chapterStore,
        saver,
        fetchPage: async (id) => loadedOf(await fetchPageDetail(id)),
        putState: (id, state, version) => putPageState(id, state, version),
        queue,
        onError: (e) => setError(errorMessage(e)),
      }),
    [saver, queue],
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
      void serial(() => finalSave(saver, editorStore, () => lockChapter(chapterId)));
    };
  }, [saver, chapterId]);

  const lockEnabled = lockable && pageIds.length > 0;
  const lock = useChapterLock(chapterId, lockEnabled);
  const busyRef = useRef(busyPageIds);
  busyRef.current = busyPageIds;
  const [recovery, setRecovery] = useState<RecoveryItem[] | null>(null);
  /** Đã quét IndexedDB xong — trước đó chưa cho sửa (sửa sẽ ghi đè bản ghi đang chờ khôi phục). */
  const [scanDone, setScanDone] = useState(false);
  /**
   * `lock.state` lúc khoá bị tắt (chương chưa có page / đang cắt trang): bật lại thì object cũ vẫn báo "held" cho tới
   * khi hook khoá chạy lại → không coi là đang giữ khoá (lưu lúc đó sẽ 423).
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
        // Vừa mở lại quyền sửa: page active còn bận thì vẫn chỉ xem (trước khi lưu phần đang chờ).
        session.setBusy(busyRef.current);
        void saver.flush();
      }
    } else if (st === "acquiring") {
      if (s.readOnly === null || s.readOnly === "processing") s.setReadOnly("loading");
    } else s.setReadOnly("lock_denied");
  }, [lock.state, lockEnabled, recovery, saver, scanDone, session]);

  // Page vào/ra lượt dịch (theo progress) → read-only "page_busy" của page active. `busyCheck` đổi = vừa hỏi lại
  // progress vì server báo bận: chạy lại cả khi tập bận không đổi (trang đã hết bận) để gỡ read-only.
  const [busyCheck, setBusyCheck] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: busyCheck chỉ để chạy lại effect.
  useEffect(() => session.setBusy(busyPageIds), [session, busyPageIds, busyCheck]);
  const { refetchProgress } = opts;
  useEffect(
    () =>
      session.watchSaverBusy(() => {
        void refetchProgress()
          .catch(() => undefined)
          .finally(() => setBusyCheck((n) => n + 1));
      }),
    [session, refetchProgress],
  );

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

  const runAi = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T> => {
      const out = await session.runAi(fn);
      // Trang vừa vào lượt dịch thành trang bận ngay, không đợi lần poll kế.
      await refetchProgress().catch(() => undefined);
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
    recovery,
    restore,
    runAi,
  };
}
