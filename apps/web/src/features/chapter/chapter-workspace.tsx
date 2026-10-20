/**
 * Màn chương = editor gộp (`/w/:ws/s/:s/c/:c?page=`): thanh trên + băng khoá | rail trang · canvas cuộn liên tục
 * cả chương · inspector | bảng dưới (P4). Chương nháp: canvas là tiến độ upload + vùng thả để tải tiếp.
 *
 * Page đang sửa (active) đổi khi bấm vào page trên canvas, chọn ở rail, phím ←/→ hoặc `?page=` đổi từ ngoài;
 * cuộn chỉ cập nhật `?page=` (page ở giữa khung, replace, gộp 400ms).
 */
import "../editor/editor.css";
import "./chapter-workspace.css";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { deleteBox } from "../editor/actions.ts";
import { ChapterCanvas } from "../editor/canvas/ChapterCanvas.tsx";
import { useOcrRegion } from "../editor/canvas/OcrSelect.tsx";
import type { SlotImages } from "../editor/canvas/PageSlot.tsx";
import { chapterStore, focusPage, useChapterStore } from "../editor/chapter-store.ts";
import { AiUpdatePanel } from "../editor/panels/AiUpdatePanel.tsx";
import { CanvasStatus, CanvasToolbar } from "../editor/panels/CanvasToolbar.tsx";
import { ConflictList } from "../editor/panels/ConflictList.tsx";
import { MaskPanel } from "../editor/panels/MaskPanel.tsx";
import { Properties } from "../editor/panels/Properties.tsx";
import { RegionTable } from "../editor/panels/RegionTable.tsx";
import { editorStore, type Tool, useEditor } from "../editor/store.ts";
import { type RecoveryItem, useChapterSession } from "../editor/use-chapter-session.ts";
import { ApplyGlossaryDialog } from "../glossary/ApplyGlossary.tsx";
import { ChapterUploadStatus, resumeFromFiles } from "../upload/chapter-upload-status.tsx";
import { DropZone } from "../upload/drop-zone.tsx";
import { uploadManager, useChapterUpload } from "../upload/upload-manager.ts";
import { cancelChapter, commitChapter, REJECT_REASON, retranslate, retryFailed } from "./api.ts";
import { ChapterTopbar, LockBand } from "./chapter-topbar.tsx";
import { ExportDialog } from "./ExportDialog.tsx";
import { FindReplaceDialog } from "./FindReplace.tsx";
import { PageRail } from "./page-rail.tsx";
import { needsReview } from "./page-status.ts";
import { type ChapterCommand, primaryAction } from "./primary-action.ts";
import { isChapterSettled } from "./status.ts";
import { useChapterData } from "./use-chapter-data.ts";

const TOOL_KEYS: Record<string, Tool> = { v: "select", t: "text", b: "brush", e: "eraser", o: "ocr" };
const URL_SYNC_MS = 400;
const NO_PAGES: never[] = [];

type Props = { ws: string; seriesId: string; chapterId: string; page?: string };

export function ChapterWorkspace({ ws, seriesId, chapterId, page: searchPage }: Props) {
  const navigate = useNavigate();
  const data = useChapterData(ws, chapterId);
  const status = data.progress?.chapter.status ?? data.detail?.status;
  const settled = isChapterSettled(status);
  const pages = data.progress?.pages ?? NO_PAGES;
  const pageIds = useMemo(() => pages.map((p) => p.id), [pages]);
  const session = useChapterSession({
    ws,
    chapterId,
    settled,
    pageIds,
    refetchProgress: data.refetchProgress,
  });
  const { kit } = session;
  const activeId = useEditor((s) => s.pageId);
  const [notice, setNotice] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"export" | "find" | "glossary" | null>(null);

  // Cache page active có version mới (AI dịch xong, tìm & thay…) → nạp lại nếu chưa sửa gì.
  useEffect(
    () => chapterStore.subscribe((s, prev) => s.cache !== prev.cache && session.session.syncActive()),
    [session.session],
  );

  // ---- Page active ↔ `?page=` ----
  const initialPage = useRef(searchPage ?? null);
  const lastUrlPage = useRef<string | null>(searchPage ?? null);
  const { setError } = session;
  const activate = useCallback(
    (id: string) => {
      setError(null);
      void session.session.activate(id);
    },
    [session.session, setError],
  );
  const go = useCallback(
    (id: string | undefined) => {
      if (!id) return;
      activate(id);
      focusPage(id);
    },
    [activate],
  );
  // Mở chương: kích hoạt page của `?page=` (hoặc page đầu) khi đã có danh sách page.
  const firstId = pageIds[0];
  useEffect(() => {
    if (!firstId || editorStore.getState().pageId) return;
    const want = initialPage.current && pageIds.includes(initialPage.current) ? initialPage.current : firstId;
    activate(want);
  }, [firstId, pageIds, activate]);
  // `?page=` đổi từ ngoài (link "Mở trang" của tìm & thay, nút lùi trình duyệt) → kích hoạt + cuộn tới.
  useEffect(() => {
    if (!searchPage || searchPage === lastUrlPage.current) return;
    lastUrlPage.current = searchPage;
    if (!pageIds.includes(searchPage)) return;
    // Link "Mở trang" trong hộp thoại tìm & thay → đóng hộp thoại để thấy trang.
    setDialog(null);
    go(searchPage);
  }, [searchPage, pageIds, go]);
  // Cuộn → `?page=` = page ở giữa khung (replace, gộp).
  const centerId = useChapterStore((s) => s.centerPageId);
  useEffect(() => {
    if (!centerId || centerId === lastUrlPage.current) return;
    const t = setTimeout(() => {
      lastUrlPage.current = centerId;
      void navigate({
        to: "/w/$ws/s/$seriesId/c/$chapterId",
        params: { ws, seriesId, chapterId },
        search: { page: centerId },
        replace: true,
      });
    }, URL_SYNC_MS);
    return () => clearTimeout(t);
  }, [centerId, navigate, ws, seriesId, chapterId]);

  // ---- Phím tắt ----
  const idx = pages.findIndex((p) => p.id === activeId);
  const keysRef = useRef({ prev: () => {}, next: () => {} });
  keysRef.current = { prev: () => go(pages[idx - 1]?.id), next: () => go(pages[idx + 1]?.id) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && t.closest("input, textarea, select, [contenteditable], dialog")) return;
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

  // ---- Thao tác chương ----
  const upload = uploadManager.view(chapterId, useChapterUpload(chapterId));
  const counts = data.progress?.counts ?? {};
  const ready = counts.ready ?? 0;
  const primary = status
    ? primaryAction({
        status,
        sourceFiles: data.detail?.source_files.length ?? 0,
        upload,
        pages: pages.length,
        ready,
      })
    : null;
  const review = pages.filter(needsReview).length;
  const summary = pages.length ? `AI xong ${ready}/${pages.length}${review ? ` · ${review} cần xem` : ""}` : null;

  const { runAi } = session;
  const action = useMutation({
    mutationFn: async (kind: "retry" | "retranslate" | "cancel" | "commit") => {
      if (kind === "cancel") return `Đã huỷ ${(await cancelChapter(ws, chapterId)).cancelled} job.`;
      if (kind === "retry") {
        const r = await runAi(() => retryFailed(ws, chapterId));
        return r.jobs.length ? `Đã xếp lại ${r.jobs.length} job cho trang lỗi.` : "Không có trang lỗi.";
      }
      if (kind === "retranslate") {
        await runAi(() => retranslate(ws, chapterId));
        return "Đã xếp dịch lại cả chương (chỉnh sửa tay được giữ nguyên).";
      }
      const r = await commitChapter(ws, chapterId);
      return r.rejected.length
        ? `Bắt đầu dịch ${r.accepted} ảnh; loại ${r.rejected.length}: ${r.rejected
            .map((x) => `#${x.ord + 1} ${REJECT_REASON[x.reason]}`)
            .join(", ")}.`
        : `Bắt đầu dịch ${r.accepted} ảnh.`;
    },
    onSuccess: (text) => setNotice({ tone: "info", text }),
    onError: (e) => setNotice({ tone: "danger", text: errorMessage(e) }),
    onSettled: data.refresh,
  });
  const onCommand = (cmd: ChapterCommand) => {
    if (cmd === "export") return openDialog("export");
    if (cmd === "upload") return;
    action.mutate(cmd);
  };
  const [resumeError, setResumeError] = useState<string | null>(null);
  const resume = (files: File[]) => {
    setResumeError(null);
    resumeFromFiles(ws, chapterId, files).catch((e: unknown) => setResumeError(errorMessage(e)));
  };
  const openDialog = (d: "export" | "find" | "glossary") => {
    // Xuất / tìm & thay / áp glossary đọc-ghi ở server: lưu phần đang sửa trước.
    void session.saver.flush().then(() => setDialog(d));
  };
  const closeDialog = () => {
    setDialog(null);
    data.refresh();
  };

  const back = async () => {
    await session.saver.flush();
    void navigate({ to: "/w/$ws/s/$seriesId", params: { ws, seriesId } });
  };

  // ---- Ảnh + OCR của page active ----
  const slotImages = useMemo(() => {
    const m = new Map<string, SlotImages>();
    for (const [id, p] of data.images)
      m.set(id, { original: p.images.original, clean: p.images.clean, cleanRev: p.clean_rev });
    return m;
  }, [data.images]);
  const activeMeta = pages[idx];
  const defaultFont = kit?.manifest.defaults[0] ?? "PatrickHand-Regular";
  const ocr = useOcrRegion(ws, activeId ?? "", defaultFont, { w: activeMeta?.width ?? 0, h: activeMeta?.height ?? 0 });
  const tool = useEditor((s) => s.tool);
  const hasStrokes = useEditor((s) => s.mask.strokes.length > 0);
  const selection = useEditor((s) => s.selection);
  const showMask = tool === "brush" || tool === "eraser" || hasStrokes;

  const errors = [
    session.fontError,
    session.error,
    imageError,
    ocr.error,
    data.error ? errorMessage(data.error) : null,
  ];
  const isDraft = status === "draft";
  const canTools = settled && pages.length > 0;

  return (
    <div className="cw">
      <ChapterTopbar
        ws={ws}
        seriesId={seriesId}
        detail={data.detail}
        status={status}
        summary={summary}
        primary={primary}
        pending={action.isPending}
        onCommand={onCommand}
        onUploadFiles={resume}
        onBack={() => void back()}
      />
      <LockBand
        status={status}
        hasPages={pages.length > 0}
        lock={session.lock.state}
        lockEnabled={session.lockEnabled}
        onRetryLock={() => void session.lock.retry()}
      />
      <PageRail pages={pages} images={data.images} activeId={activeId} onPick={go} />
      <main className="cw-main">
        <Notices
          errors={errors}
          notice={notice}
          onDismiss={() => setNotice(null)}
          recovery={session.recovery}
          canRestore={session.lock.state.status === "held" && session.lockEnabled}
          onRecovery={(accept) => void session.restore(accept)}
        />
        {isDraft || pages.length === 0 ? (
          <div className="cw-empty">
            {isDraft ? (
              <>
                <ChapterUploadStatus ws={ws} chapterId={chapterId} onResume={resume} resumeError={resumeError} />
                {!upload && (
                  <p className="muted">
                    Chương nháp: {data.detail?.source_files.length ?? 0} ảnh đã khai báo. Bấm "Dịch chương" khi đã tải
                    đủ ảnh.
                  </p>
                )}
                {primary?.command === "upload" && (
                  <DropZone
                    label="Tải tiếp ảnh"
                    size="md"
                    title="Thả lại đúng bộ file của chương để tải tiếp"
                    hint="Ảnh đã tải được bỏ qua — chỉ tải phần còn thiếu"
                    onFiles={resume}
                  />
                )}
              </>
            ) : (
              <p className="muted">
                {status === "ingesting" ? "Đang ghép và cắt trang theo bóng thoại…" : "Chưa có trang."}
              </p>
            )}
          </div>
        ) : (
          <div className="cw-canvas">
            {kit ? (
              <ChapterCanvas
                kit={kit}
                images={slotImages}
                defaultFont={defaultFont}
                initialPageId={initialPage.current}
                ocrPending={ocr.pending}
                onOcr={(r) => void ocr.start(r)}
                onActivate={activate}
                onImageError={setImageError}
              />
            ) : (
              <div className="ed-canvas ed-loading">
                <span className="muted">Đang tải…</span>
              </div>
            )}
            <CanvasToolbar />
            <CanvasStatus />
          </div>
        )}
      </main>
      <aside className="ed-side cw-side" aria-label="Bảng thuộc tính">
        {activeMeta ? (
          <>
            <div className="cw-side-head">
              <h2>Trang {activeMeta.ord + 1}</h2>
              <span className="muted small">{selection ? "Khung chữ đang chọn" : "Chưa chọn khung chữ"}</span>
            </div>
            <AiUpdatePanel ws={ws} />
            <ConflictList />
            {showMask && activeId && (
              <MaskPanel
                ws={ws}
                pageId={activeId}
                cleanRev={activeMeta.clean_rev}
                page={{ w: activeMeta.width, h: activeMeta.height }}
                onDone={data.refresh}
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
          </>
        ) : (
          <p className="muted small ed-pad cw-pad">Chưa có trang để sửa.</p>
        )}
      </aside>
      <BottomPanel canTools={canTools} onTool={openDialog} />
      {dialog === "export" && <ExportDialog ws={ws} chapterId={chapterId} onClose={closeDialog} />}
      {dialog === "find" && (
        <FindReplaceDialog
          ws={ws}
          seriesId={seriesId}
          chapterId={chapterId}
          lock={session.lock}
          onClose={closeDialog}
        />
      )}
      {dialog === "glossary" && (
        <ApplyGlossaryDialog
          ws={ws}
          seriesId={seriesId}
          chapterId={chapterId}
          lock={session.lock}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}

function Notices(props: {
  errors: (string | null | undefined)[];
  notice: { tone: "info" | "danger"; text: string } | null;
  onDismiss(): void;
  recovery: RecoveryItem[] | null;
  canRestore: boolean;
  onRecovery(accept: boolean): void;
}) {
  const errors = [...new Set(props.errors.filter((e): e is string => !!e))];
  const rec = props.recovery;
  return (
    <div className="ed-notices">
      {rec && rec.length > 0 && (
        <div className="notice info">
          Có thay đổi chưa lưu từ phiên trước ở trang {rec.map((r) => r.ord + 1).join(", ")} (
          {new Date(Math.max(...rec.map((r) => r.updatedAt))).toLocaleString("vi-VN")}).{" "}
          <button
            type="button"
            className="btn-primary"
            disabled={!props.canRestore}
            title={props.canRestore ? undefined : "Cần giữ khoá chương để khôi phục"}
            onClick={() => props.onRecovery(true)}
          >
            Khôi phục
          </button>{" "}
          <button type="button" className="btn-ghost" onClick={() => props.onRecovery(false)}>
            Bỏ
          </button>
        </div>
      )}
      {props.notice && (
        <div className={`notice ${props.notice.tone}`}>
          {props.notice.text}{" "}
          <button type="button" className="btn-ghost" onClick={props.onDismiss}>
            Đóng
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

type LayoutPrefs = { bottomOpen: boolean; bottomH: number };
const LAYOUT_KEY = "mtl.layout";
const MIN_H = 120;

function readLayout(): LayoutPrefs {
  // Màn hẹp (< 1600px): bảng dưới mặc định thu gọn.
  const fallback = { bottomOpen: typeof innerWidth === "number" && innerWidth >= 1600, bottomH: 280 };
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<LayoutPrefs>;
    return {
      bottomOpen: typeof v.bottomOpen === "boolean" ? v.bottomOpen : fallback.bottomOpen,
      bottomH: typeof v.bottomH === "number" && v.bottomH >= MIN_H ? v.bottomH : fallback.bottomH,
    };
  } catch {
    return fallback;
  }
}

/** Bảng văn bản toàn chương (P4 lấp nội dung): kéo cao, thu gọn; nhớ trong localStorage `mtl.layout`. */
function BottomPanel(props: { canTools: boolean; onTool(t: "find" | "glossary"): void }) {
  const [prefs, setPrefs] = useState(readLayout);
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(prefs));
    } catch {
      // Không lưu được (chế độ riêng tư) → chỉ mất ghi nhớ bố cục.
    }
  }, [prefs]);
  const drag = useRef<{ y: number; h: number } | null>(null);

  return (
    <section
      className="cw-bottom"
      aria-label="Bảng văn bản chương"
      style={{ height: prefs.bottomOpen ? prefs.bottomH : undefined }}
    >
      {prefs.bottomOpen && (
        <button
          type="button"
          className="cw-resize"
          aria-label="Kéo để đổi chiều cao bảng"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { y: e.clientY, h: prefs.bottomH };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const max = Math.max(MIN_H, innerHeight - 260);
            setPrefs((p) => ({ ...p, bottomH: Math.min(max, Math.max(MIN_H, d.h + d.y - e.clientY)) }));
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
        />
      )}
      <div className="cw-bottom-head">
        <span className="cw-bottom-title">Bản dịch</span>
        <button type="button" disabled={!props.canTools} onClick={() => props.onTool("find")}>
          Tìm &amp; thay
        </button>
        <button type="button" disabled={!props.canTools} onClick={() => props.onTool("glossary")}>
          Áp glossary
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="btn-ghost"
          aria-expanded={prefs.bottomOpen}
          onClick={() => setPrefs((p) => ({ ...p, bottomOpen: !p.bottomOpen }))}
        >
          {prefs.bottomOpen ? "Thu gọn" : "Mở bảng"}
        </button>
      </div>
      {prefs.bottomOpen && (
        <div className="cw-bottom-body muted small">Bảng văn bản toàn chương sẽ hiện ở đây (đang làm).</div>
      )}
    </section>
  );
}
