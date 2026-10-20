/**
 * Màn chương = editor gộp (`/w/:ws/s/:s/c/:c?page=`): thanh trên (+ băng cảnh báo khi có) | rail trang · canvas cuộn liên tục
 * cả chương · inspector | bảng dưới (Bản dịch cả chương / Tìm–Thay / Áp glossary). Chương nháp: canvas là tiến
 * độ upload + vùng thả để tải tiếp + ảnh gốc xem trước (cả lúc đang cắt trang).
 *
 * Trạng thái chương chỉ ở chip thanh trên (+ rail theo trang). Kết quả thao tác (dịch lại, áp kiểu…) là thông báo nổi
 * trên canvas, tự ẩn; Dịch chương (bấm tay hoặc tự dịch khi upload xong) thành công không báo gì thêm (chip đã đổi),
 * chỉ báo khi có ảnh bị loại; tự dịch lỗi → báo lỗi, chương ở lại nháp với nút "Dịch chương".
 *
 * Drawer phải: Xuất (nút "Xuất" hoặc `?drawer=export` từ "Xuất lại" ở home), Hoạt động, Phím tắt (`?`). Chế độ xem
 * Gốc / Dịch / Chia đôi + giữ `O` (chapterStore.viewMode). Phím tắt: `editor/shortcuts.ts` (1 listener).
 *
 * Page đang sửa (active) đổi khi bấm vào page trên canvas, chọn ở rail, phím ←/→/A/D, focus 1 dòng của bảng hoặc
 * `?page=` đổi từ ngoài; cuộn chỉ cập nhật `?page=` (page ở giữa khung, replace, gộp 400ms). Khối đang chọn
 * (`current`, khoá dòng bảng) đồng bộ 2 chiều giữa bảng, canvas và inspector.
 */
import "../editor/editor.css";
import "./chapter-workspace.css";
import type { PageState } from "@mtl/shared";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../lib/api.ts";
import { deleteBox, setStyleMany } from "../editor/actions.ts";
import { ChapterCanvas } from "../editor/canvas/ChapterCanvas.tsx";
import { type PageRect, useOcrRegion } from "../editor/canvas/OcrSelect.tsx";
import type { SlotImages, SlotProcessing } from "../editor/canvas/PageSlot.tsx";
import { chapterStore, focusPage, revealRect, useChapterStore } from "../editor/chapter-store.ts";
import { CanvasStatus, CanvasToolbar } from "../editor/panels/CanvasToolbar.tsx";
import type { ShortcutAction } from "../editor/shortcuts.ts";
import { editorStore, useEditor } from "../editor/store.ts";
import { resetChapterSession, useChapterSession } from "../editor/use-chapter-session.ts";
import { useShortcuts } from "../editor/use-shortcuts.ts";
import { ApplyGlossaryPanel } from "../glossary/ApplyGlossary.tsx";
import { ChapterUploadStatus, resumeFromFiles } from "../upload/chapter-upload-status.tsx";
import { DropZone } from "../upload/drop-zone.tsx";
import { uploadManager, useChapterUpload } from "../upload/upload-manager.ts";
import { ActivityDrawer, chapterActivityCount, useUploadCount } from "./activity-drawer.tsx";
import {
  cancelChapter,
  commitChapter,
  type FindMatch,
  REJECT_REASON,
  type Rejected,
  retranslate,
  retryFailed,
} from "./api.ts";
import { BottomPanel, type TabRequest } from "./bottom-panel.tsx";
import { ChapterTopbar, type EditAccess, LockBand } from "./chapter-topbar.tsx";
import { ExportDrawer } from "./export-drawer.tsx";
import { isExportActive, useExports } from "./export-panel.tsx";
import { FindReplacePanel } from "./FindReplace.tsx";
import { Inspector } from "./inspector.tsx";
import { PageRail } from "./page-rail.tsx";
import { needsReview, pageLevel } from "./page-status.ts";
import { type ChapterCommand, primaryAction } from "./primary-action.ts";
import { ShortcutHelp } from "./shortcut-help.tsx";
import { SourcePreview } from "./source-preview.tsx";
import { chapterChip, isChapterSettled } from "./status.ts";
import { filterRows, KIND_LABEL, type Row, rowKeyOfBox, sameKindBoxIds, type TableFilter } from "./text-table/rows.ts";
import { TableFilters, TextTable, useChapterRows } from "./text-table/text-table.tsx";
import { useChapterData } from "./use-chapter-data.ts";

const URL_SYNC_MS = 400;
/** Thông báo kết quả (info) tự ẩn sau chừng này; lỗi giữ tới khi đóng. */
const NOTICE_MS = 6000;
const NO_PAGES: never[] = [];

type DrawerKind = "export" | "activity" | "help";
type Props = { ws: string; seriesId: string; chapterId: string; page?: string; drawer?: "export" };
/** `untilStable`: giữ tới khi chương chạy xong lượt xử lý vừa bắt đầu (ảnh bị loại khi Dịch chương). */
type Notice = { tone: "info" | "warn" | "danger"; text: string; untilStable?: boolean };

/** Dịch chương mà có ảnh bị loại: giữ tới khi chương chạy xong lượt xử lý vừa bắt đầu. */
const rejectedNotice = (accepted: number, rejected: Rejected[]): Notice => ({
  tone: "warn",
  untilStable: true,
  text: `Đang dịch ${accepted} ảnh; loại ${rejected.length}: ${rejected
    .map((x) => `#${x.ord + 1} ${REJECT_REASON[x.reason]}`)
    .join(", ")}.`,
});

/**
 * Store editor/chương dùng chung cả tab: phiên mới bắt đầu sạch. Reset ở layout effect (sau khi cây của chương cũ đã
 * gỡ, trước khi vẽ) rồi mới render màn chương — reset trong lúc render thì component còn subscribe store của chương
 * cũ bị cập nhật giữa lúc render (cảnh báo React "Cannot update a component while rendering…").
 */
export function ChapterWorkspace(props: Props) {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    resetChapterSession(props.chapterId);
    setReady(true);
  }, [props.chapterId]);
  return ready ? <Workspace {...props} /> : null;
}

function Workspace({ ws, seriesId, chapterId, page: searchPage, drawer: searchDrawer }: Props) {
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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  // Mở từ "Xuất lại" (`?drawer=export`): drawer Xuất mở ngay; URL bỏ tham số ở lần đồng bộ `?page=` kế tiếp.
  const [drawer, setDrawer] = useState<DrawerKind | null>(searchDrawer ?? null);
  const [tabRequest, setTabRequest] = useState<TabRequest | null>(null);
  const openTab = useCallback(
    (tab: string, focus?: string) => setTabRequest((r) => ({ tab, focus, seq: (r?.seq ?? 0) + 1 })),
    [],
  );

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
  // `?drawer=export` chỉ dùng lúc mở: bỏ khỏi URL (tải lại trang không mở lại drawer).
  useEffect(() => {
    if (!searchDrawer) return;
    void navigate({
      to: "/w/$ws/s/$seriesId/c/$chapterId",
      params: { ws, seriesId, chapterId },
      search: searchPage ? { page: searchPage } : {},
      replace: true,
    });
  }, [searchDrawer, searchPage, navigate, ws, seriesId, chapterId]);
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
  const chip = status
    ? chapterChip({ status, pages: pages.length, ready, failed: counts.failed ?? 0, review, upload })
    : null;
  const access: EditAccess = {
    lock: session.lock.state,
    lockEnabled: session.lockEnabled,
    hasPages: pages.length > 0,
  };

  // Thông báo info tự ẩn; "ảnh bị loại" giữ tới khi chương qua lượt xử lý vừa bắt đầu rồi ổn định lại.
  const busySeen = useRef(false);
  const notify = useCallback((n: Notice | null) => {
    busySeen.current = false;
    setNotice(n);
  }, []);
  useEffect(() => {
    if (!notice) return;
    if (notice.untilStable) {
      if (!settled) busySeen.current = true;
      else if (busySeen.current) setNotice(null);
      return;
    }
    if (notice.tone !== "info") return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice, settled]);

  const { runAi } = session;
  const action = useMutation({
    mutationFn: async (
      kind: "retry" | "retranslate" | "retranslate-page" | "cancel" | "commit",
    ): Promise<Notice | null> => {
      const info = (text: string): Notice => ({ tone: "info", text });
      if (kind === "cancel") return info(`Đã huỷ ${(await cancelChapter(ws, chapterId)).cancelled} job.`);
      if (kind === "retry") {
        const r = await runAi(() => retryFailed(ws, chapterId));
        return info(r.jobs.length ? `Đã xếp lại ${r.jobs.length} job cho trang lỗi.` : "Không có trang lỗi.");
      }
      if (kind === "retranslate-page") {
        const id = editorStore.getState().pageId;
        const ord = pages.find((p) => p.id === id)?.ord ?? 0;
        if (!id) return info("Chưa chọn trang.");
        await runAi(() => retranslate(ws, chapterId, [id]));
        return info(`Đã xếp dịch lại trang ${ord + 1} (chỉnh sửa tay được giữ nguyên).`);
      }
      if (kind === "retranslate") {
        await runAi(() => retranslate(ws, chapterId));
        return info("Đã xếp dịch lại cả chương (chỉnh sửa tay được giữ nguyên).");
      }
      // Thành công: chip trạng thái đã nói "Đang cắt trang/Đang dịch" — chỉ báo khi có ảnh bị loại.
      const r = await commitChapter(ws, chapterId);
      return r.rejected.length ? rejectedNotice(r.accepted, r.rejected) : null;
    },
    onMutate: () => notify(null),
    onSuccess: notify,
    onError: (e) => notify({ tone: "danger", text: errorMessage(e) }),
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
    onSuccess: (text) => notify({ tone: "info", text }),
    onError: (e) => notify({ tone: "danger", text: errorMessage(e) }),
  });

  // Tự dịch khi upload xong (upload-manager): chỉ báo lúc kết quả vừa đổi, không báo lại khi mở lại chương.
  const autoCommit = useChapterUpload(chapterId)?.autoCommit ?? null;
  const seenAuto = useRef(autoCommit);
  useEffect(() => {
    if (autoCommit === seenAuto.current) return;
    seenAuto.current = autoCommit;
    if (autoCommit?.status === "failed") {
      notify({ tone: "danger", text: `Không tự dịch được: ${autoCommit.error}. Bấm "Dịch chương" để thử lại.` });
    } else if (autoCommit?.status === "done" && autoCommit.rejected.length) {
      notify(rejectedNotice(autoCommit.accepted, autoCommit.rejected));
    }
  }, [autoCommit, notify]);

  const onCommand = (cmd: ChapterCommand) => {
    if (cmd === "export") return setDrawer("export");
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
  // Page chưa xong → canvas hiện ảnh gốc + nhãn; khoá theo chữ ký để lần poll tiến độ không đổi gì thì không vẽ lại.
  const processingSig = pages
    .map((p) => {
      const level = pageLevel(p.status);
      return level === "busy" || level === "todo" ? `${p.id}=${level}` : "";
    })
    .filter(Boolean)
    .join(",");
  const processing = useMemo(
    () => new Map(processingSig ? processingSig.split(",").map((e) => e.split("=") as [string, SlotProcessing]) : []),
    [processingSig],
  );
  const idx = pages.findIndex((p) => p.id === activeId);
  const activeMeta = pages[idx];
  const defaultFont = kit?.manifest.defaults[0] ?? "Bangers-Regular";
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

  // ---- Phím tắt (1 listener, bảng ở editor/shortcuts.ts) ----
  const drawerRef = useRef(drawer);
  drawerRef.current = drawer;
  /** false = không làm gì (trình duyệt xử lý phím như thường). */
  const keys = useRef<(a: ShortcutAction) => boolean | undefined>(() => undefined);
  keys.current = (a) => {
    const s = editorStore.getState();
    const cs = chapterStore.getState();
    switch (a.type) {
      case "tool":
        return void s.setTool(a.tool);
      case "holdOriginalStart":
        return void cs.setHoldOriginal(true);
      case "holdOriginalEnd":
        return void cs.setHoldOriginal(false);
      case "toggleOriginal":
        return void cs.setViewMode(cs.viewMode === "original" ? "translated" : "original");
      case "page":
        go(pages[idx + a.dir]?.id);
        return;
      case "block": {
        // Khối trước/sau theo thứ tự bảng (xuyên trang); chưa có khối hiện tại → khối đầu/cuối của page active.
        const i = allRows.findIndex((r) => r.key === current);
        const onPage = allRows.filter((r) => r.pageId === activeId);
        const row = i >= 0 ? allRows[i + a.dir] : a.dir > 0 ? onPage[0] : onPage.at(-1);
        if (row) void pick(row);
        return;
      }
      case "undo":
        return void s.undo();
      case "redo":
        return void s.redo();
      case "save":
        void session.saver.flush();
        return;
      case "find":
        if (!canTools) return false;
        openTab("find", "#fr-find");
        return;
      case "editText":
        if (s.selection && !s.readOnly) s.setEditing(s.selection);
        return;
      case "deleteBox":
        if (s.selection) s.apply(deleteBox(s.selection));
        return;
      case "escape":
        return void s.select(null);
      case "help":
        setDrawer((d) => (d === "help" ? null : "help"));
        return;
    }
  };
  useShortcuts({
    run: (a) => keys.current(a),
    context: () => ({ selection: !!editorStore.getState().selection }),
    blocked: () => drawerRef.current !== null,
  });

  // ---- Drawer ----
  const uploadCount = useUploadCount();
  const exportsActive = (useExports(ws, chapterId).q.data?.exports ?? []).filter((x) =>
    isExportActive(x.status),
  ).length;
  const activityCount = uploadCount + chapterActivityCount(data.progress, exportsActive);
  const closeDrawer = useCallback(() => setDrawer(null), []);

  return (
    <div className="cw">
      <ChapterTopbar
        ws={ws}
        seriesId={seriesId}
        detail={data.detail}
        chip={chip}
        access={access}
        primary={primary}
        pending={action.isPending}
        onCommand={onCommand}
        onUploadFiles={resume}
        onBack={() => void back()}
        onMoved={(to) =>
          void navigate({
            to: "/w/$ws/s/$seriesId/c/$chapterId",
            params: { ws, seriesId: to, chapterId },
            search: searchPage ? { page: searchPage } : {},
            replace: true,
          })
        }
        activityCount={activityCount}
        onActivity={() => setDrawer("activity")}
        onHelp={() => setDrawer("help")}
      />
      <LockBand
        access={access}
        onRetryLock={() => void session.lock.retry()}
        recovery={session.recovery}
        canRestore={session.lock.state.status === "held" && session.lockEnabled}
        onRecovery={(accept) => void session.restore(accept)}
      />
      <PageRail pages={pages} images={data.images} activeId={activeId} overflow={overflowPages} onPick={go} />
      <main className="cw-main">
        <Notices errors={errors} notice={notice} onDismiss={() => notify(null)} />
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
                <SourcePreview ws={ws} chapterId={chapterId} />
              </>
            ) : (
              <>
                <p className="muted">
                  {status === "ingesting"
                    ? "Đang ghép và cắt trang theo bóng thoại…"
                    : status === "partial_failed"
                      ? `Cắt trang lỗi${ingestError ? `: ${ingestError}` : ""} — bấm "Chạy lại cắt trang" để cắt lại từ ảnh đã tải.`
                      : "Chưa có trang."}
                </p>
                <SourcePreview ws={ws} chapterId={chapterId} />
              </>
            )}
          </div>
        ) : (
          <div className="cw-canvas">
            <CanvasToolbar />
            {kit ? (
              <ChapterCanvas
                kit={kit}
                images={slotImages}
                processing={processing}
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
        request={tabRequest}
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
      {drawer === "export" && (
        <ExportDrawer
          ws={ws}
          chapterId={chapterId}
          detail={data.detail}
          pages={pages}
          rows={allRows}
          beforeStart={flush}
          onShowWarnings={() => {
            setFilter({ review: true, page: false });
            openTab("text");
            setDrawer(null);
            data.refresh();
          }}
          onClose={() => {
            setDrawer(null);
            data.refresh();
          }}
        />
      )}
      {drawer === "activity" && (
        <ActivityDrawer
          ws={ws}
          chapter={{
            id: chapterId,
            progress: data.progress,
            canRetry: settled,
            retrying: action.isPending,
            onRetry: () => action.mutate("retry"),
          }}
          onClose={closeDrawer}
        />
      )}
      {drawer === "help" && <ShortcutHelp onClose={closeDrawer} />}
    </div>
  );
}

/** Lỗi + kết quả thao tác: nổi trên canvas (CSS `.cw-toasts`), không đẩy bố cục. */
function Notices(props: { errors: (string | null | undefined)[]; notice: Notice | null; onDismiss(): void }) {
  const errors = [...new Set(props.errors.filter((e): e is string => !!e))];
  return (
    <div className="ed-notices cw-toasts" aria-live="polite">
      {props.notice && (
        <div className={`notice ${props.notice.tone}`} role={props.notice.tone === "danger" ? "alert" : "status"}>
          {props.notice.text}{" "}
          <button type="button" className="btn-ghost" onClick={props.onDismiss}>
            Đóng
          </button>
        </div>
      )}
      {errors.map((e) => (
        <div key={e} className="notice danger" role="alert">
          {e}
        </div>
      ))}
    </div>
  );
}
