/**
 * Màn chương = editor gộp (`/w/:ws/s/:s/c/:c?page=`): thanh trên + băng khoá | rail trang · canvas cuộn liên tục
 * cả chương · inspector | bảng dưới (Bản dịch cả chương / Tìm–Thay / Áp glossary). Chương nháp: canvas là tiến
 * độ upload + vùng thả để tải tiếp.
 *
 * Page đang sửa (active) đổi khi bấm vào page trên canvas, chọn ở rail, phím ←/→, focus 1 dòng của bảng hoặc
 * `?page=` đổi từ ngoài; cuộn chỉ cập nhật `?page=` (page ở giữa khung, replace, gộp 400ms). Khối đang chọn
 * (`current`, khoá dòng bảng) đồng bộ 2 chiều giữa bảng, canvas và inspector.
 */
import "../editor/editor.css";
import "./chapter-workspace.css";
import type { PageState } from "@mtl/shared";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { deleteBox, setStyleMany } from "../editor/actions.ts";
import { ChapterCanvas } from "../editor/canvas/ChapterCanvas.tsx";
import { type PageRect, useOcrRegion } from "../editor/canvas/OcrSelect.tsx";
import type { SlotImages } from "../editor/canvas/PageSlot.tsx";
import { chapterStore, focusPage, revealRect, useChapterStore } from "../editor/chapter-store.ts";
import { CanvasStatus, CanvasToolbar } from "../editor/panels/CanvasToolbar.tsx";
import { editorStore, type Tool, useEditor } from "../editor/store.ts";
import { type RecoveryItem, useChapterSession } from "../editor/use-chapter-session.ts";
import { ApplyGlossaryPanel } from "../glossary/ApplyGlossary.tsx";
import { ChapterUploadStatus, resumeFromFiles } from "../upload/chapter-upload-status.tsx";
import { DropZone } from "../upload/drop-zone.tsx";
import { uploadManager, useChapterUpload } from "../upload/upload-manager.ts";
import { cancelChapter, commitChapter, type FindMatch, REJECT_REASON, retranslate, retryFailed } from "./api.ts";
import { BottomPanel } from "./bottom-panel.tsx";
import { ChapterTopbar, LockBand } from "./chapter-topbar.tsx";
import { ExportDialog } from "./ExportDialog.tsx";
import { FindReplacePanel } from "./FindReplace.tsx";
import { Inspector } from "./inspector.tsx";
import { PageRail } from "./page-rail.tsx";
import { needsReview } from "./page-status.ts";
import { type ChapterCommand, primaryAction } from "./primary-action.ts";
import { isChapterSettled } from "./status.ts";
import { filterRows, KIND_LABEL, type Row, rowKeyOfBox, sameKindBoxIds, type TableFilter } from "./text-table/rows.ts";
import { TableFilters, TextTable, useChapterRows } from "./text-table/text-table.tsx";
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
  const [exporting, setExporting] = useState(false);

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

  // ---- Bảng văn bản ↔ canvas ↔ inspector ----
  const allRows = useChapterRows(kit);
  const [current, setCurrent] = useState<string | null>(null);
  const [filter, setFilter] = useState<TableFilter>({ review: false, page: false });
  const rows = useMemo(() => filterRows(allRows, filter, activeId, current), [allRows, filter, activeId, current]);
  const rowsRef = useRef(allRows);
  rowsRef.current = allRows;
  /** Chọn 1 khối: kích hoạt page của nó (lưu page cũ trước), chọn box, cuộn canvas nếu khối ngoài khung. */
  const pick = useCallback(
    async (row: Pick<Row, "key" | "pageId" | "boxId" | "rect">) => {
      setCurrent(row.key);
      if (editorStore.getState().pageId !== row.pageId) {
        setError(null);
        await session.session.activate(row.pageId);
      }
      const s = editorStore.getState();
      if (s.pageId !== row.pageId) return;
      if (s.selection !== row.boxId) s.select(row.boxId);
      revealRect(row.pageId, row.rect);
    },
    [session.session, setError],
  );
  // Chọn box trên canvas → dòng tương ứng thành dòng hiện tại (bảng cuộn tới). Bỏ chọn box (bấm nền, Esc) → bỏ
  // dòng hiện tại để inspector về thông tin trang; trừ dòng không có box (vùng chưa có khung: chọn từ bảng).
  useEffect(
    () =>
      editorStore.subscribe((s, prev) => {
        if (s.selection === prev.selection || !s.pageId || !s.doc) return;
        if (!s.selection) {
          setCurrent((c) => (rowsRef.current.find((r) => r.key === c)?.boxId ? null : c));
          return;
        }
        const box = s.doc.text_boxes.find((b) => b.id === s.selection);
        if (box) setCurrent(rowKeyOfBox(s.pageId, box, s.doc));
      }),
    [],
  );
  /** Bấm 1 kết quả Tìm/Thay hoặc Áp glossary → nhảy tới khối đó (mở tab Bản dịch giữ nguyên tab hiện tại). */
  const jump = (m: FindMatch) => {
    const row = allRows.find((r) => r.pageId === m.page_id && (r.regionId === m.id || r.boxId === m.id));
    if (row) void pick(row);
    else go(m.page_id);
  };
  const currentRow = allRows.find((r) => r.key === current && r.pageId === activeId) ?? null;
  // Giữ nguyên object Set khi tập page tràn không đổi (rail memo không render lại mỗi lần gõ).
  const overflowKey = [...new Set(allRows.filter((r) => r.flags.includes("overflow")).map((r) => r.pageId))].join(",");
  const overflowPages = useMemo(() => new Set(overflowKey ? overflowKey.split(",") : []), [overflowKey]);
  const activeOverflow = allRows.filter((r) => r.pageId === activeId && r.flags.includes("overflow")).length;

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
  const review = pages.filter((p) => needsReview(p, overflowPages.has(p.id))).length;
  const summary = pages.length ? `AI xong ${ready}/${pages.length}${review ? ` · ${review} cần xem` : ""}` : null;

  const { runAi } = session;
  const action = useMutation({
    mutationFn: async (kind: "retry" | "retranslate" | "retranslate-page" | "cancel" | "commit") => {
      if (kind === "cancel") return `Đã huỷ ${(await cancelChapter(ws, chapterId)).cancelled} job.`;
      if (kind === "retry") {
        const r = await runAi(() => retryFailed(ws, chapterId));
        return r.jobs.length ? `Đã xếp lại ${r.jobs.length} job cho trang lỗi.` : "Không có trang lỗi.";
      }
      if (kind === "retranslate-page") {
        const id = editorStore.getState().pageId;
        const ord = pages.find((p) => p.id === id)?.ord ?? 0;
        if (!id) return "Chưa chọn trang.";
        await runAi(() => retranslate(ws, chapterId, [id]));
        return `Đã xếp dịch lại trang ${ord + 1} (chỉnh sửa tay được giữ nguyên).`;
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
  // "Áp kiểu này cho khối cùng loại trong chương" (inspector hỏi xác nhận trước): page active = 1 bước undo; page
  // khác ghi thẳng (cần khoá, không hoàn tác được). Lỗi giữa chừng → báo rõ trang nào đã áp.
  const applyKind = useMutation({
    mutationFn: async (row: Row) => {
      const s = editorStore.getState();
      const src = s.doc?.text_boxes.find((b) => b.id === row.boxId);
      if (!s.doc || !s.layout || !src) return "Chưa chọn khung chữ.";
      const { font_family, font_size, line_height, pad, align, fill, stroke, auto_fit } = src;
      // Box tự khớp: cỡ chữ là kết quả khớp của riêng box đó — không chép sang box khác.
      const style = {
        font_family,
        line_height,
        pad,
        align,
        fill,
        stroke,
        auto_fit,
        ...(auto_fit ? {} : { font_size }),
      };
      const layout = s.layout;
      const idsOf = (st: PageState) => sameKindBoxIds(st, row.kind, src.id);
      let boxes = 0;
      let touched = 0;
      const own = idsOf(s.doc);
      if (own.length) {
        s.apply(setStyleMany(own, style, layout));
        boxes += own.length;
        touched++;
      }
      await session.saver.flush();
      const done: number[] = [];
      for (const p of chapterStore.getState().pages) {
        const st = chapterStore.getState().cache[p.id]?.state;
        // Page có thể vừa thành active (người dùng đổi trang giữa chừng) → bỏ qua, không ghi đè bản đang sửa.
        if (p.id === editorStore.getState().pageId || !st) continue;
        const ids = idsOf(st);
        if (!ids.length) continue;
        try {
          if (await session.session.updateOther(p.id, setStyleMany(ids, style, layout))) {
            boxes += ids.length;
            touched++;
            done.push(p.ord + 1);
          }
        } catch (e) {
          const ok = done.length ? `Đã áp ở trang ${done.join(", ")}; ` : "";
          throw new Error(`${ok}lỗi ở trang ${p.ord + 1}: ${errorMessage(e)}`);
        }
      }
      return `Đã áp kiểu cho ${boxes} khối ${KIND_LABEL[row.kind].toLowerCase()} trên ${touched} trang.`;
    },
    onSuccess: (text) => setNotice({ tone: "info", text }),
    onError: (e) => setNotice({ tone: "danger", text: errorMessage(e) }),
  });

  const onCommand = (cmd: ChapterCommand) => {
    if (cmd === "export") return void session.withFlush(() => setExporting(true));
    if (cmd === "upload") return;
    action.mutate(cmd);
  };
  const [resumeError, setResumeError] = useState<string | null>(null);
  const resume = (files: File[]) => {
    setResumeError(null);
    resumeFromFiles(ws, chapterId, files).catch((e: unknown) => setResumeError(errorMessage(e)));
  };
  const flush = useCallback(() => session.saver.flush(), [session.saver]);

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
  const ocrStart = ocr.start;
  const onOcr = useCallback((r: PageRect) => void ocrStart(r), [ocrStart]);

  const errors = [
    session.fontError,
    session.error,
    imageError,
    ocr.error,
    data.error ? errorMessage(data.error) : null,
  ];
  const isDraft = status === "draft";
  const ingestError = data.progress?.jobs.find((j) => j.type === "chapter.ingest" && j.error)?.error ?? null;
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
      <PageRail pages={pages} images={data.images} activeId={activeId} overflow={overflowPages} onPick={go} />
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
                {status === "ingesting"
                  ? "Đang ghép và cắt trang theo bóng thoại…"
                  : status === "partial_failed"
                    ? `Cắt trang lỗi${ingestError ? `: ${ingestError}` : ""} — bấm "Chạy lại cắt trang" để cắt lại từ ảnh đã tải.`
                    : "Chưa có trang."}
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
                onOcr={onOcr}
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
        <Inspector
          ws={ws}
          page={activeMeta}
          row={currentRow}
          overflowCount={activeOverflow}
          kit={kit}
          busy={{
            retranslate: action.isPending,
            ocr: ocr.pending.length > 0,
            applyKind: applyKind.isPending,
          }}
          onRetranslatePage={() => action.mutate("retranslate-page")}
          onReocr={(row) => {
            const [x, y, w, h] = editorStore.getState().doc?.regions.find((r) => r.id === row.regionId)?.bbox ?? [];
            if (row.regionId && w && h) void ocr.start({ x: x ?? 0, y: y ?? 0, w, h }, row.regionId);
          }}
          onApplyKind={(row) => applyKind.mutate(row)}
          onMaskDone={data.refresh}
        />
      </aside>
      <BottomPanel
        tabs={[
          {
            id: "text",
            label: `Bản dịch · ${allRows.length} khối`,
            flush: true,
            tools: <TableFilters value={filter} onChange={setFilter} />,
            render: () => (
              <TextTable rows={rows} total={allRows.length} current={current} activeId={activeId} onPick={pick} />
            ),
          },
          {
            id: "find",
            label: "Tìm / Thay",
            disabled: !canTools,
            title: canTools ? undefined : "Dùng được khi chương dịch xong",
            render: () => (
              <FindReplacePanel
                ws={ws}
                seriesId={seriesId}
                chapterId={chapterId}
                lock={session.lock}
                beforeWrite={flush}
                onJump={jump}
              />
            ),
          },
          {
            id: "glossary",
            label: "Áp glossary",
            disabled: !canTools,
            title: canTools ? undefined : "Dùng được khi chương dịch xong",
            render: () => (
              <ApplyGlossaryPanel
                ws={ws}
                seriesId={seriesId}
                chapterId={chapterId}
                lock={session.lock}
                beforeWrite={flush}
                onJump={jump}
              />
            ),
          },
        ]}
      />
      {exporting && (
        <ExportDialog
          ws={ws}
          chapterId={chapterId}
          onClose={() => {
            setExporting(false);
            data.refresh();
          }}
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
