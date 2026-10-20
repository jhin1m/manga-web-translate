/**
 * Màn editor 1 page (toàn màn hình, ngoài layout workspace). Ghép: khoá chương (useChapterLock — heartbeat),
 * tải page + ảnh, khôi phục thay đổi chưa lưu (IndexedDB), autosave (save.ts), phím tắt, chuyển trang.
 * Không giữ được khoá → read-only (vẫn xem/so sánh được).
 */
import "./editor.css";
import { emptyPageState } from "@mtl/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { chapterKeys, fetchProgress } from "../chapter/api.ts";
import { useChapterLock } from "../chapter/use-chapter-lock.ts";
import { deleteBox } from "./actions.ts";
import { fetchEditorPage, type EditorPage as PageData, putPageState } from "./api.ts";
import { useOcrRegion } from "./canvas/OcrSelect.tsx";
import { EditorStage } from "./canvas/Stage.tsx";
import { type FontKit, loadFonts } from "./fonts.ts";
import { AiUpdatePanel } from "./panels/AiUpdatePanel.tsx";
import { ConflictList } from "./panels/ConflictList.tsx";
import { MaskPanel } from "./panels/MaskPanel.tsx";
import { PageStrip } from "./panels/PageStrip.tsx";
import { Properties } from "./panels/Properties.tsx";
import { RegionTable } from "./panels/RegionTable.tsx";
import { Toolbar } from "./panels/Toolbar.tsx";
import { PendingQueue, type PendingRecord } from "./pending-queue.ts";
import { rebase } from "./rebase.ts";
import { Saver } from "./save.ts";
import { editorStore, type Tool, useEditor } from "./store.ts";

type Props = { ws: string; seriesId: string; chapterId: string; pageId: string };

const TOOL_KEYS: Record<string, Tool> = { v: "select", t: "text", b: "brush", e: "eraser", o: "ocr" };
const queue = new PendingQueue();

const stateOf = (d: PageData) => d.state ?? emptyPageState(d.page.width, d.page.height);

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

export function EditorPage({ ws, seriesId, chapterId, pageId }: Props) {
  const navigate = useNavigate();
  const { kit, error: fontError } = useFontKit();
  const lock = useChapterLock(ws, chapterId);
  const lockHeld = useRef(false);
  lockHeld.current = lock.state.status === "held";
  const progress = useQuery({
    queryKey: chapterKeys.progress(ws, chapterId),
    queryFn: () => fetchProgress(ws, chapterId),
    refetchInterval: 15_000,
  });
  const pages = progress.data?.pages ?? [];
  const [data, setData] = useState<PageData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<PendingRecord | null>(null);
  const readOnly = useEditor((s) => s.readOnly);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const hasStrokes = useEditor((s) => s.mask.strokes.length > 0);

  const saver = useMemo(
    () =>
      new Saver(
        editorStore,
        {
          put: (id, state, version) => putPageState(ws, id, state, version),
          get: async (id) => {
            const d = await fetchEditorPage(ws, id);
            return { state: stateOf(d), version: d.version };
          },
        },
        queue,
      ),
    [ws],
  );

  // Mọi thay đổi doc → lưu nháp IndexedDB + autosave.
  useEffect(() => {
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
      flush();
      saver.dispose();
    };
  }, [saver]);

  // Khoá chương ↔ read-only. Lấy lại được khoá sau khi mất → lưu tiếp phần đang chờ.
  useEffect(() => {
    const s = editorStore.getState();
    const st = lock.state.status;
    if (st === "held") {
      if (s.readOnly === "loading" || s.readOnly === "lock_denied" || s.readOnly === "lock_lost") {
        s.setReadOnly(recovery ? "recovery" : null);
        void saver.flush();
      }
    } else if (st === "acquiring") {
      if (s.readOnly === null) s.setReadOnly("loading");
    } else s.setReadOnly("lock_denied");
  }, [lock.state.status, recovery, saver]);

  // Tải page (lưu xong page trước rồi mới đổi).
  useEffect(() => {
    let live = true;
    setLoadError(null);
    setRecovery(null);
    // Bỏ qua lời mời khôi phục của page trước (bản ghi vẫn nằm trong IndexedDB cho lần mở sau).
    if (editorStore.getState().readOnly === "recovery") {
      editorStore.getState().setReadOnly(lockHeld.current ? null : "loading");
    }
    (async () => {
      await saver.flush();
      const d = await fetchEditorPage(ws, pageId);
      if (!live) return;
      editorStore.getState().load({
        pageId,
        state: stateOf(d),
        version: d.version,
        ai: { state: d.ai_state, rev: d.ai_rev, available: d.ai_update_available },
      });
      setData(d);
      const rec = await queue.get(pageId);
      if (live && rec?.ops.length) {
        setRecovery(rec);
        editorStore.getState().setReadOnly("recovery");
      }
    })().catch((e: unknown) => live && setLoadError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [ws, pageId, saver]);

  const reloadImages = useCallback(async () => {
    const d = await fetchEditorPage(ws, pageId);
    if (editorStore.getState().pageId !== pageId) return;
    setData(d);
    editorStore.getState().setAi({ state: d.ai_state, rev: d.ai_rev, available: d.ai_update_available });
  }, [ws, pageId]);

  const restore = (accept: boolean) => {
    const rec = recovery;
    setRecovery(null);
    const s = editorStore.getState();
    s.setReadOnly(lock.state.status === "held" ? null : "lock_denied");
    if (!rec) return;
    if (!accept || !s.base) return void queue.delete(rec.pageId);
    const r = rebase(s.base, rec.ops);
    s.rebased(s.base, s.baseVersion, r.state, r.conflicts);
    saver.schedule();
  };

  const idx = pages.findIndex((p) => p.id === pageId);
  const goTo = useCallback(
    async (id: string | undefined) => {
      if (!id || id === pageId) return;
      await saver.flush();
      void navigate({
        to: "/w/$ws/series/$seriesId/chapters/$chapterId/edit/$pageId",
        params: { ws, seriesId, chapterId, pageId: id },
      });
    },
    [navigate, saver, ws, seriesId, chapterId, pageId],
  );
  const prev = () => void goTo(pages[idx - 1]?.id);
  const next = () => void goTo(pages[idx + 1]?.id);
  const keysRef = useRef({ prev, next });
  keysRef.current = { prev, next };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && t.closest("input, textarea, select, [contenteditable]")) return;
      const s = editorStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        s.redo();
      } else if (mod || e.altKey) return;
      else if (TOOL_KEYS[k]) s.setTool(TOOL_KEYS[k]);
      else if (e.key === "ArrowLeft") keysRef.current.prev();
      else if (e.key === "ArrowRight") keysRef.current.next();
      else if (e.key === "\\") s.setShowOriginal(!s.showOriginal);
      else if (e.key === "Escape") s.select(null);
      else if ((e.key === "Delete" || e.key === "Backspace") && s.selection) s.apply(deleteBox(s.selection));
      else if (e.key === "Enter" && s.selection && !s.readOnly) s.setEditing(s.selection);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const defaultFont = kit?.manifest.defaults[0] ?? "PatrickHand-Regular";
  const ocr = useOcrRegion(ws, pageId, defaultFont);
  const page = data && data.page.id === pageId ? data : null;
  const showMask = tool === "brush" || tool === "eraser" || hasStrokes;

  return (
    <div className="editor">
      <Toolbar
        ws={ws}
        seriesId={seriesId}
        chapterId={chapterId}
        ord={idx >= 0 ? idx : null}
        total={pages.length}
        onPrev={prev}
        onNext={next}
      />
      <PageStrip pages={pages} current={pageId} onGo={(id) => void goTo(id)} />
      <main className="ed-main">
        <Notices
          lock={lock.state}
          onRetryLock={() => void lock.retry()}
          readOnly={readOnly}
          errors={[fontError, loadError, imageError, ocr.error]}
          recovery={recovery}
          onRecovery={restore}
        />
        {kit && page ? (
          <EditorStage
            kit={kit}
            images={{ original: page.images.original, clean: page.images.clean, cleanRev: page.page.clean_rev }}
            page={{ w: page.page.width, h: page.page.height }}
            defaultFont={defaultFont}
            ocrPending={ocr.pending}
            onOcr={(r) => void ocr.start(r)}
            onImageError={setImageError}
          />
        ) : (
          <div className="ed-canvas ed-loading">
            {loadError || fontError ? null : <span className="muted">Đang tải trang…</span>}
          </div>
        )}
      </main>
      <aside className="ed-side" aria-label="Bảng thuộc tính">
        <AiUpdatePanel ws={ws} />
        <ConflictList />
        {showMask && page && (
          <MaskPanel
            ws={ws}
            pageId={pageId}
            cleanRev={page.page.clean_rev}
            page={{ w: page.page.width, h: page.page.height }}
            onDone={() => void reloadImages()}
          />
        )}
        <section>
          <h3 className="ed-h">{selection ? "Khung chữ" : "Thuộc tính"}</h3>
          <Properties fonts={kit?.ids ?? []} />
        </section>
        <section>
          <h3 className="ed-h">Vùng chữ</h3>
          <RegionTable />
        </section>
      </aside>
    </div>
  );
}

const READ_ONLY_TEXT = {
  lock_denied: null,
  lock_lost:
    "Mất khoá chương (hết hạn hoặc người khác đã mở). Thay đổi chưa lưu vẫn giữ trên máy này; editor ở chế độ chỉ xem.",
  loading: null,
  recovery: null,
} as const;

function Notices(props: {
  lock: ReturnType<typeof useChapterLock>["state"];
  onRetryLock(): void;
  readOnly: ReturnType<typeof editorStore.getState>["readOnly"];
  errors: (string | null)[];
  recovery: PendingRecord | null;
  onRecovery(accept: boolean): void;
}) {
  const { lock } = props;
  const errors = props.errors.filter(Boolean);
  const ro = props.readOnly ? READ_ONLY_TEXT[props.readOnly] : null;
  return (
    <div className="ed-notices">
      {lock.status === "denied" && (
        <div className="notice">
          {lock.holderName ?? "Người khác"} đang sửa chương này — bạn chỉ xem được.{" "}
          <button type="button" className="btn-ghost" onClick={props.onRetryLock}>
            Thử lại
          </button>
        </div>
      )}
      {lock.status === "error" && <div className="notice danger">Không lấy được khoá chương: {lock.message}</div>}
      {ro && <div className="notice danger">{ro}</div>}
      {props.recovery && (
        <div className="notice info">
          Có {props.recovery.ops.length} thay đổi chưa lưu từ phiên trước (
          {new Date(props.recovery.updatedAt).toLocaleString("vi-VN")}).{" "}
          <button type="button" className="btn-primary" onClick={() => props.onRecovery(true)}>
            Khôi phục
          </button>{" "}
          <button type="button" className="btn-ghost" onClick={() => props.onRecovery(false)}>
            Bỏ
          </button>
        </div>
      )}
      {errors.map((e) => (
        <div key={e} className="notice danger">
          {e}
        </div>
      ))}
    </div>
  );
}
