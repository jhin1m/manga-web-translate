/**
 * Màn chương = editor gộp (`/s/:s/c/:c?page=`): thanh trên (+ băng cảnh báo khi có) | rail công cụ · panel ngữ
 * cảnh (mỗi lúc 1 panel: khối đang chọn / Văn bản = tab Bản dịch · Tìm / Thay · Glossary · Hiệu đính; bấm lại icon đang mở thì thu) ·
 * canvas từng trang · cột trang. Chương chưa có page (nháp, đang cắt trang, cắt lỗi): cột trang là từng ảnh gốc (xoá /
 * khôi phục trước khi cắt trang), canvas là ảnh đang chọn + tiến độ upload + vùng thả để tải tiếp. Upload xong không
 * tự chạy: "Dịch chương" = cắt trang → xoá chữ + OCR → dịch theo lô, nối một mạch; menu ⋯ "Chỉ xoá chữ + OCR" dừng ở
 * "Chờ dịch" (xem ảnh sạch, sửa mask) tới khi bấm "Dịch chương". ⌘/Ctrl/Shift-click thumbnail chọn trang → "Dịch N trang".
 *
 * Panel khối (rail "Chọn"): đóng mặc định, đè lên canvas (canvas không đổi bề ngang), tự mở khi chọn khối hoặc khi có
 * nội dung phải xử lý (AI có bản mới, xung đột khi lưu), đóng khi bỏ chọn nếu hết nội dung; khối bị panel che thì canvas
 * tự cuộn lộ ra (`revealBlockView`). Chữ / Tẩy chữ / Quét chữ dùng thanh phụ nổi trên canvas thay panel.
 *
 * Trạng thái chương chỉ ở chip thanh trên (+ rail theo trang). Kết quả thao tác (dịch lại, áp kiểu…) là thông báo nổi
 * trên canvas, tự ẩn; "Dịch chương" thành công không báo gì thêm (chip đã đổi), chỉ báo khi có ảnh bị loại. Lượt xuất
 * xong lúc menu Xuất đã đóng → thông báo kèm nút "Tải xuống".
 *
 * Menu Xuất dưới nút "Xuất" (hoặc `?drawer=export` từ "Xuất lại" ở home; mục Xuất trong menu ⋯ khi chương có trang lỗi); drawer
 * phải: Hoạt động, Phím tắt (`?`). Chế độ xem
 * (chapterStore.viewMode): nút "Xem gốc" + giữ `O`, Chia đôi trong menu ⋯. Thao tác khối (Dịch lại · Nhân đôi · Xoá) ở
 * đầu panel khối; thao tác trang (Dịch / Dịch lại, Bỏ chỉnh sửa tay, Ẩn) ở menu chuột phải cột trang. Phím tắt:
 * `editor/shortcuts.ts` (1 listener).
 *
 * Page đang sửa (active) = page canvas đang hiện; đổi khi chọn ở cột trang, nút ‹ › góc dưới canvas, phím ←/→/A/D, focus 1
 * dòng của bảng hoặc `?page=` đổi từ ngoài; page active ghi lại vào `?page=` (replace, gộp 400ms). Khối đang chọn
 * (`current`, khoá dòng bảng) đồng bộ 2 chiều giữa bảng, canvas và panel Chọn.
 */
import "../editor/editor.css";
import "./chapter-workspace.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import Konva from "konva";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../lib/api.ts";
import { deleteBox, resetToAI, setStyleMany } from "../editor/actions.ts";
import { ChapterCanvas } from "../editor/canvas/ChapterCanvas.tsx";
import { type PageRect, useOcrRegion } from "../editor/canvas/OcrSelect.tsx";
import type { SlotImages, SlotProcessing } from "../editor/canvas/PageSlot.tsx";
import { chapterStore, revealRect, revealSelection, selectionUnderCover } from "../editor/chapter-store.ts";
import { readAutoErase, writeAutoErase } from "../editor/erase-queue.ts";
import { dialogueFont } from "../editor/fonts.ts";
import { batchOnTop } from "../editor/history.ts";
import { ConflictList } from "../editor/panels/ConflictList.tsx";
import { MaskToolBar } from "../editor/panels/MaskToolBar.tsx";
import { diffStates } from "../editor/rebase.ts";
import type { ShortcutAction } from "../editor/shortcuts.ts";
import { type EditorState, editorStore, useEditor } from "../editor/store.ts";
import { resetChapterSession, useChapterSession } from "../editor/use-chapter-session.ts";
import { useShortcuts } from "../editor/use-shortcuts.ts";
import { ApplyGlossaryPanel } from "../glossary/ApplyGlossary.tsx";
import { fetchSeries, learnSkipImage, seriesKeys } from "../series/api.ts";
import { ChapterUploadStatus, resumeFromFiles } from "../upload/chapter-upload-status.tsx";
import { DropZone } from "../upload/drop-zone.tsx";
import { uploadManager, useChapterUpload } from "../upload/upload-manager.ts";
import { ActivityDrawer, chapterActivityCount, useUploadCount } from "./activity-drawer.tsx";
import {
  cancelChapter,
  commitChapter,
  type FindMatch,
  type ProgressPage,
  REJECT_REASON,
  type Rejected,
  retranslate,
  retryFailed,
  setPageSkip,
  translatePrepared,
  undoBatch,
} from "./api.ts";
import { CanvasPager } from "./canvas-controls.tsx";
import { ChapterTopbar, type EditAccess, LockBand } from "./chapter-topbar.tsx";
import { ContextPanel, type FocusRequest } from "./context-panel.tsx";
import { DocTabs, docPanelId, docTabId } from "./doc-tabs.tsx";
import { ExportMenu } from "./export-menu.tsx";
import { isExportActive } from "./export-options.ts";
import { triggerDownload, useExports } from "./export-panel.tsx";
import { type BatchHooks, FindReplacePanel } from "./FindReplace.tsx";
import { providerWait, providerWaitShort, providerWaitText } from "./job-error.ts";
import { clearLegacyLayout } from "./layout-prefs.ts";
import { PageRail } from "./page-rail.tsx";
import { clickSelect, EMPTY_SELECTION, pruneSelection, type Selection, selectionIds } from "./page-selection.ts";
import { isPageBusy, needsReview, pageLevel } from "./page-status.ts";
import { type ChapterCommand, primaryAction } from "./primary-action.ts";
import { ProofreadPanel, usePendingProofread } from "./proofread-panel.tsx";
import { BlockActions, SelectPanel } from "./select-panel.tsx";
import { ShortcutHelp } from "./shortcut-help.tsx";
import { SourceRail } from "./source-rail.tsx";
import { type IngestView, moveItem, type SourceItem, sourceCounts, stepSource } from "./source-rail-model.ts";
import { SourceViewer } from "./source-viewer.tsx";
import { stageLabel } from "./stage-labels.ts";
import { chapterChip, chapterProgress, chipWithActivity, isChapterSettled, nextReviewPage } from "./status.ts";
import { filterRows, KIND_LABEL, type Row, rowKeyOfBox, sameKindBoxIds, type TableFilter } from "./text-table/rows.ts";
import { TableFilters, TextTable, useChapterRows } from "./text-table/text-table.tsx";
import { describeWriteError } from "./text-utils.ts";
import { CanvasToolBar, OcrToolBar, TextToolBar } from "./tool-panels.tsx";
import { ToolRail } from "./tool-rail.tsx";
import { type DocTab, isWidePanel, PANEL_TITLE, type PanelId, type RailTarget, railClick } from "./tool-rail-model.ts";
import { undoStyleText } from "./undo-style-text.ts";
import { useChapterData } from "./use-chapter-data.ts";
import { useReorderSources, useSetSourceSkip, useSourceImages } from "./use-source-images.ts";

const URL_SYNC_MS = 400;
/** Thông báo kết quả (info) tự ẩn sau chừng này; lỗi giữ tới khi đóng. */
const NOTICE_MS = 6000;
const NO_PAGES: never[] = [];

type DrawerKind = "export" | "activity" | "help";
type Props = { seriesId: string; chapterId: string; page?: string; drawer?: "export" };
/** Mảng rỗng cố định (series chưa tải) — không đổi tham chiếu mỗi lần render. */
const NO_IGNORE: readonly string[] = [];

/**
 * Có nội dung phải xử lý ở panel khối dù không chọn khối: xung đột khi lưu, hoặc AI có bản mới cho trang đang mở. Còn
 * nội dung này thì panel tự mở và không tự đóng.
 */
const hasAiUpdate = (s: Pick<EditorState, "ai" | "doc" | "pageId">) =>
  s.ai.available && !!s.ai.state && !!s.doc && !!s.pageId;
const hasToolContent = (s: Pick<EditorState, "conflicts" | "ai" | "doc" | "pageId">) =>
  s.conflicts.length > 0 || hasAiUpdate(s);
/**
 * `untilStable`: giữ tới khi chương chạy xong lượt xử lý vừa bắt đầu (ảnh bị loại khi Dịch chương). `sticky`: info
 * không tự ẩn (VD "Đã xuất xong" + nút tải). `actions`: nút kèm thông báo (vd. "Hoàn tác", "Luôn bỏ ở series này" sau
 * khi xoá ảnh).
 */
type Notice = {
  tone: "info" | "warn" | "danger";
  text: string;
  untilStable?: boolean;
  sticky?: boolean;
  actions?: { label: string; run(): void }[];
  /** Nhóm thông báo — "skip": khôi phục ảnh/trang chỉ đóng thông báo "Đã xoá / Đã ẩn…", không đụng lỗi khác. */
  key?: "skip" | "reorder";
};

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

function Workspace({ seriesId, chapterId, page: searchPage, drawer: searchDrawer }: Props) {
  const navigate = useNavigate();
  const data = useChapterData(chapterId);
  const status = data.progress?.chapter.status ?? data.detail?.status;
  const settled = isChapterSettled(status);
  const pages = data.progress?.pages ?? NO_PAGES;
  const pageIds = useMemo(() => pages.map((p) => p.id), [pages]);
  // Giữ khoá cả lúc đang dịch; chỉ chưa có trang / đang cắt trang thì chưa có gì để sửa.
  const lockable = !!status && status !== "draft" && status !== "ingesting";
  // Trang đang xử lý hoặc còn chờ lượt trong chuỗi dịch (`translate_queued`) → chỉ xem.
  const busyKey = pages
    .filter(isPageBusy)
    .map((p) => p.id)
    .join(",");
  const busyPageIds = useMemo(() => new Set(busyKey ? busyKey.split(",") : []), [busyKey]);
  const session = useChapterSession({
    chapterId,
    lockable,
    pageIds,
    busyPageIds,
    refetchProgress: data.refetchProgress,
  });
  const { kit } = session;
  // Font thoại của series cho box tạo tay (cùng key với màn series → lưu cài đặt là cập nhật).
  const series = useQuery({ queryKey: seriesKeys.detail(seriesId), queryFn: () => fetchSeries(seriesId) });
  const queryClient = useQueryClient();
  const activeId = useEditor((s) => s.pageId);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Toast "Hoàn tác" của lượt áp kiểu: cách duy nhất hoàn tác lượt này nên tách khỏi `notice` (thông báo khác không đè mất).
  const [styleUndo, setStyleUndo] = useState<Notice | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  // Mở từ "Xuất lại" (`?drawer=export`): menu Xuất mở ngay; URL bỏ tham số ở lần đồng bộ `?page=` kế tiếp.
  const [drawer, setDrawer] = useState<DrawerKind | null>(searchDrawer ?? null);
  // Nút đã mở menu Xuất (nút "Xuất" hoặc nút ⋯): menu căn theo nút và trả focus về đó khi đóng.
  const [exportOpener, setExportOpener] = useState<HTMLElement | null>(null);
  // ---- Rail công cụ + panel ngữ cảnh ----
  const tool = useEditor((s) => s.tool);
  // Panel đóng mặc định; mở theo ngữ cảnh (chọn khối, nội dung phải xử lý) hoặc bằng rail.
  const [panel, setPanel] = useState<PanelId | null>(null);
  // Panel Văn bản: mỗi tab mount lần đầu khi mở, sau đó chỉ ẩn (giữ kết quả xem trước Tìm/Thay, vị trí cuộn bảng).
  const [docTab, setDocTab] = useState<DocTab>("table");
  const [seenTabs, setSeenTabs] = useState<ReadonlySet<DocTab>>(() => new Set());
  const [focusReq, setFocusReq] = useState<FocusRequest | null>(null);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  // Khoá bố cục của bản cũ nhớ panel đang mở: bỏ để mặc định đóng có hiệu lực.
  useEffect(() => clearLegacyLayout(), []);

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
  /** Cuộn quá mép page: như pager nhưng cho canvas đợi xong để đặt khung nhìn + hiệu ứng. */
  const activateAwait = useCallback(
    (id: string) => {
      setError(null);
      return session.session.activate(id);
    },
    [session.session, setError],
  );
  const go = useCallback(
    (id: string | undefined) => {
      if (!id) return;
      activate(id);
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
      to: "/s/$seriesId/c/$chapterId",
      params: { seriesId, chapterId },
      search: searchPage ? { page: searchPage } : {},
      replace: true,
    });
  }, [searchDrawer, searchPage, navigate, seriesId, chapterId]);
  // Đổi trang → `?page=` = page active (replace, gộp). URL chưa có `?page=` = đang ở trang đầu → mở chương không
  // ghi thêm gì.
  useEffect(() => {
    if (!activeId || activeId === (lastUrlPage.current ?? firstId)) return;
    const t = setTimeout(() => {
      lastUrlPage.current = activeId;
      void navigate({
        to: "/s/$seriesId/c/$chapterId",
        params: { seriesId, chapterId },
        search: { page: activeId },
        replace: true,
      });
    }, URL_SYNC_MS);
    return () => clearTimeout(t);
  }, [activeId, firstId, navigate, seriesId, chapterId]);

  // ---- Bảng văn bản ↔ canvas ↔ panel Chọn ----
  const allRows = useChapterRows(kit, series.data?.ignore_text ?? NO_IGNORE);
  const [current, setCurrent] = useState<string | null>(null);
  const [filter, setFilter] = useState<TableFilter>({ review: false, page: false });
  const rows = useMemo(() => filterRows(allRows, filter, activeId, current), [allRows, filter, activeId, current]);
  const rowsRef = useRef(allRows);
  rowsRef.current = allRows;
  /** Có khối đang chọn kể cả dòng không có khung chữ (chọn từ bảng) — panel khối vẫn có gì để hiện. */
  const hasBlock = useRef(false);
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
  // Khối được chọn ngay lúc nhấn chuột (có thể đang bắt đầu kéo): panel đè lên canvas ngay lúc đó sẽ chắn con trỏ giữa
  // chừng kéo, và cuộn lộ khối làm khối lệch khỏi chỗ thả. Đang nhấn chuột thì hoãn tới khi nhả.
  const pointerDown = useRef(false);
  // Panel khối vừa thu vì đổi sang công cụ khác (Chữ, Tẩy…): phím V về Chọn mở lại nó. Thu bằng × / Esc thì V không mở.
  const collapsedByTool = useRef(false);
  useEffect(() => {
    const down = () => {
      pointerDown.current = true;
    };
    const up = () => {
      pointerDown.current = false;
    };
    addEventListener("pointerdown", down, true);
    addEventListener("pointerup", up, true);
    addEventListener("pointercancel", up, true);
    return () => {
      removeEventListener("pointerdown", down, true);
      removeEventListener("pointerup", up, true);
      removeEventListener("pointercancel", up, true);
    };
  }, []);
  // Panel khối tự mở/đóng theo ngữ cảnh. Mở: chọn (hoặc chọn lại) khối trên canvas ở công cụ Chọn, về công cụ Chọn khi còn khối
  // đang chọn mà panel vừa thu vì đổi công cụ (thu bằng × / Esc thì không mở lại; đang ở Bản dịch / Tìm thì giữ), hoặc
  // có nội dung phải xử lý mà không chọn khối (AI có bản mới, xung đột khi lưu — đổi trang là mất danh sách xung đột).
  // Đóng: bỏ chọn khối (bấm nền, Esc, đổi trang) khi hết nội dung — còn xung đột / AI mới thì panel ở lại. Đổi sang công
  // cụ có thanh phụ cũng thu panel khi hết nội dung. Chọn khối cũng đặt dòng bảng tương ứng thành dòng hiện tại (bảng cuộn
  // tới); bỏ chọn → bỏ dòng hiện tại, trừ dòng không có box (vùng chưa có khung: chọn từ bảng).
  useEffect(() => {
    const openToolPanel = () => {
      const s = editorStore.getState();
      if (
        panelRef.current === null &&
        (((s.selection || hasBlock.current) && s.tool === "select") || hasToolContent(s))
      )
        setPanel("tool");
    };
    // Bấm chuột chọn khối nằm dưới chỗ panel sắp đè: panel mở ngay sẽ che / dời khối trước khi lần bấm thứ hai của nhấp
    // đúp (sửa chữ trên ảnh) kịp tới → đợi hết cửa sổ nhấp đúp; thành nhấp đúp thì bỏ mở.
    let pending: ReturnType<typeof setTimeout> | undefined;
    const cancelPending = () => {
      clearTimeout(pending);
      pending = undefined;
    };
    const openAfterPointer = () => {
      cancelPending();
      const root = document.querySelector(".cw");
      const w = (root && Number.parseFloat(getComputedStyle(root).getPropertyValue("--cw-overlay-w"))) || 272;
      if (selectionUnderCover(w)) pending = setTimeout(openToolPanel, Konva.dblClickWindow);
      else openToolPanel();
    };
    const unsub = editorStore.subscribe((s, prev) => {
      const content = hasToolContent(s);
      if (content && !hasToolContent(prev) && panelRef.current === null) setPanel("tool");
      // Chọn lại đúng khối đang chọn (panel đã thu bằng nút thu / công cụ khác) hoặc về công cụ Chọn khi còn khối chọn
      // mà panel vừa thu vì đổi công cụ.
      const backToSelect = s.tool === "select" && prev.tool !== "select";
      const reselected = s.reselects > prev.reselects || (backToSelect && collapsedByTool.current);
      if (backToSelect) collapsedByTool.current = false;
      if (reselected && (s.selection || hasBlock.current) && panelRef.current === null) {
        if (pointerDown.current) addEventListener("pointerup", openAfterPointer, { once: true });
        else openToolPanel();
      }
      if ((s.editing && !prev.editing) || s.selection !== prev.selection) cancelPending();
      if (s.selection !== prev.selection && s.pageId && s.doc) {
        if (!s.selection) {
          setCurrent((c) => (rowsRef.current.find((r) => r.key === c)?.boxId ? null : c));
        } else {
          if (panelRef.current === null && s.tool === "select") {
            if (pointerDown.current) addEventListener("pointerup", openAfterPointer, { once: true });
            else openToolPanel();
          }
          const box = s.doc.text_boxes.find((b) => b.id === s.selection);
          if (box) setCurrent(rowKeyOfBox(s.pageId, box, s.doc));
        }
      }
      if (panelRef.current === "tool" && !content) {
        const deselected = !!prev.selection && !s.selection;
        const contentGone = hasToolContent(prev) && !s.selection;
        const toolLeft = s.tool !== prev.tool && s.tool !== "select";
        if (deselected || contentGone || toolLeft) {
          collapsedByTool.current = toolLeft && !deselected;
          setPanel(null);
        }
      }
    });
    return () => {
      unsub();
      cancelPending();
    };
  }, []);
  /** Bấm 1 kết quả Tìm/Thay hoặc Áp glossary → nhảy tới khối đó (panel Tìm giữ nguyên). */
  const jump = (m: FindMatch) => {
    const row = allRows.find((r) => r.pageId === m.page_id && (r.regionId === m.id || r.boxId === m.id));
    if (row) void pick(row);
    else go(m.page_id);
  };
  const currentRow = allRows.find((r) => r.key === current && r.pageId === activeId) ?? null;
  hasBlock.current = !!currentRow;
  // Giữ nguyên object Set khi tập page tràn không đổi (rail memo không render lại mỗi lần gõ).
  const overflowKey = [...new Set(allRows.filter((r) => r.flags.includes("overflow")).map((r) => r.pageId))].join(",");
  const overflowPages = useMemo(() => new Set(overflowKey ? overflowKey.split(",") : []), [overflowKey]);
  const activeBlocks = allRows.filter((r) => r.pageId === activeId).length;

  // ---- Thao tác chương ----
  const uploadState = useChapterUpload(chapterId);
  const upload = uploadManager.view(chapterId, uploadState);
  const counts = data.progress?.counts ?? {};
  const ready = counts.ready ?? 0;
  const declared = data.detail?.source_files ?? [];
  const skippedFiles = declared.filter((f) => f.skip !== null).length;
  const uploaded = uploadManager.uploadedIds(chapterId, uploadState);
  const pendingFiles = uploaded ? declared.filter((f) => f.skip === null && !uploaded.has(f.id)).length : 0;
  const primary = status
    ? primaryAction({
        status,
        sourceFiles: declared.length - skippedFiles,
        skippedFiles,
        pendingFiles,
        upload,
        pages: pages.length,
        ready,
        failed: counts.failed ?? 0,
      })
    : null;
  const reviewIds = new Set(pages.filter((p) => needsReview(p, overflowPages.has(p.id))).map((p) => p.id));
  const review = reviewIds.size;
  const chipInput = status && {
    status,
    pages: pages.length,
    ready,
    failed: counts.failed ?? 0,
    review,
    preparing: (counts.pending ?? 0) + (counts.preparing ?? 0),
    upload,
    run: data.progress?.chapter.run,
  };
  const chip = chipInput ? chapterChip(chipInput) : null;
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
    if (notice.tone !== "info" || notice.sticky) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice, settled]);

  // ---- Chọn trang để dịch riêng (⌘/Ctrl/Shift-click ở cột trang) ----
  const [pageSel, setPageSel] = useState<Selection>(EMPTY_SELECTION);
  // Trang đã chọn mà vào lượt dịch (hoặc bị ẩn) rơi hẳn khỏi lựa chọn — hết bận không tự chọn lại.
  useEffect(() => setPageSel((s) => pruneSelection(s, pages)), [pages]);
  const selectedIds = selectionIds(pageSel, pages);
  const selectedKey = selectedIds.join(",");
  const selectedSet = useMemo(() => new Set(selectedKey ? selectedKey.split(",") : []), [selectedKey]);
  const onSelectPage = useCallback(
    (id: string, mod: { shift: boolean; toggle: boolean }) => setPageSel((s) => clickSelect(s, pages, id, mod)),
    [pages],
  );
  const clearSelection = useCallback(() => setPageSel(EMPTY_SELECTION), []);
  // Bấm thường 1 thumbnail = mở trang đó và bỏ chọn.
  const pickPage = useCallback(
    (id: string) => {
      setPageSel(EMPTY_SELECTION);
      go(id);
    },
    [go],
  );

  const { runAi } = session;
  const action = useMutation({
    mutationFn: async (
      kind:
        | "retry"
        | "retranslate"
        | "translate-pages"
        | "cancel"
        | "commit"
        | "prepare_only"
        | "translate"
        | { retranslatePage: ProgressPage },
    ): Promise<Notice | null> => {
      const info = (text: string): Notice => ({ tone: "info", text });
      if (typeof kind === "object") {
        const page = kind.retranslatePage;
        await runAi(() => retranslate(chapterId, [page.id]));
        const n = page.ord + 1;
        return info(
          page.status === "prepared"
            ? `Đã xếp dịch trang ${n}.`
            : `Đã xếp dịch lại trang ${n} (chỉnh sửa tay được giữ nguyên).`,
        );
      }
      if (kind === "cancel") return info(`Đã huỷ ${(await cancelChapter(chapterId)).cancelled} job.`);
      if (kind === "retry") {
        const r = await runAi(() => retryFailed(chapterId));
        return info(r.jobs.length ? `Đã xếp lại ${r.jobs.length} job cho trang lỗi.` : "Không có trang lỗi.");
      }
      if (kind === "translate-pages") {
        if (!selectedIds.length) return info("Chưa chọn trang.");
        const sent = pageSel;
        await runAi(() => retranslate(chapterId, selectedIds));
        // Chọn lại trong lúc chờ server → giữ lựa chọn mới.
        setPageSel((s) => (s === sent ? EMPTY_SELECTION : s));
        return info(`Đã xếp dịch ${selectedIds.length} trang (chỉnh sửa tay được giữ nguyên).`);
      }
      if (kind === "translate") {
        // Chip đã đổi sang "Đang dịch" — không báo thêm.
        await runAi(() => translatePrepared(chapterId));
        return null;
      }
      if (kind === "retranslate") {
        await runAi(() => retranslate(chapterId));
        return info("Đã xếp dịch lại cả chương (chỉnh sửa tay được giữ nguyên).");
      }
      // Thành công: chip đã đổi ("Đang cắt trang", …) — chỉ báo khi có ảnh bị loại.
      const r = await commitChapter(chapterId, kind === "prepare_only" ? "prepared" : "translated");
      return r.rejected.length ? rejectedNotice(r.accepted, r.rejected) : null;
    },
    onMutate: () => notify(null),
    onSuccess: notify,
    onError: (e) =>
      notify({
        tone: "danger",
        text:
          e instanceof ApiError && e.body.error === "translate_running"
            ? "Đang có lượt dịch — chờ lượt này xong hoặc huỷ rồi thử lại."
            : e instanceof ApiError && e.body.error === "page_not_prepared"
              ? "Có trang chưa xoá chữ + OCR xong — chạy lại trang lỗi trước rồi dịch."
              : errorMessage(e),
      }),
    onSettled: data.refresh,
  });
  // "Áp kiểu này cho khối cùng loại trong chương": mọi trang (kể cả trang đang mở) ghi trong 1 lượt chung batch_id →
  // hoàn tác cả lượt bằng toast "Hoàn tác" hoặc Cmd+Z khi lượt là bước cuối của trang đang mở (cùng mutation này).
  const styleUndoBatch = useRef<string | null>(null);
  // Tên từng lượt cho thông báo hoàn tác ("áp kiểu" mặc định) + lượt vừa hoàn tác (panel Tìm/Thay bỏ nút Hoàn tác treo).
  const batchLabels = useRef(new Map<string, string>());
  const [undoneBatch, setUndoneBatch] = useState<string | null>(null);
  // 1 khoá chung cho mọi đường hoàn tác lượt (nút toast, Cmd+Z, nút Hoàn tác của panel): đang có yêu cầu bay thì bỏ qua yêu
  // cầu mới — hai yêu cầu cùng lúc làm lượt bị hoàn tác 2 lần hoặc báo "không hoàn tác được" sau khi đã thành công.
  const undoBusy = useRef(false);
  const [undoing, setUndoing] = useState(false);
  const acquireUndo = () => {
    if (undoBusy.current) return false;
    undoBusy.current = true;
    setUndoing(true);
    return true;
  };
  const releaseUndo = () => {
    undoBusy.current = false;
    setUndoing(false);
  };
  const batchHooks = (label: string): BatchHooks => ({
    begin: acquireUndo,
    end: releaseUndo,
    busy: undoing,
    applied: (r) => {
      batchLabels.current.set(r.batch_id, label);
      session.session.recordServerBatch(r.batch_id, r.versions);
    },
    undone: (batchId, r) => {
      session.session.afterBatchUndo(batchId, r.skipped);
      setUndoneBatch(batchId);
    },
    lastUndone: undoneBatch,
  });
  const runUndo = (batchId: string) => {
    if (acquireUndo()) undoKind.mutate(batchId);
  };
  const undoKind = useMutation({
    mutationFn: async (batchId: string) => {
      await session.saver.flush();
      // Trang đã sửa tiếp sau lượt áp thì bỏ qua (không làm hỏng cả lượt) và báo rõ trang nào.
      return undoBatch(chapterId, batchId, "skip");
    },
    // Ẩn nút ngay khi bấm: bấm lần 2 sẽ thấy mọi trang "đã sửa" và báo sai. Lỗi (trừ 404 lượt không còn) thì trả lại để thử lại. Chỉ ẩn toast của chính lượt này (Cmd+Z có thể hoàn tác lượt cũ hơn).
    onMutate: (batchId) => {
      if (styleUndoBatch.current !== batchId) return null;
      const prev = styleUndo;
      setStyleUndo(null);
      return prev;
    },
    onSuccess: (r, batchId) => {
      const openId = editorStore.getState().pageId;
      // Lượt xong là bỏ mốc trong lịch sử → Cmd+Z / nút Hoàn tác không hoàn tác lại lần nữa.
      const local = session.session.afterBatchUndo(batchId, r.skipped, r.pages);
      const skipped = local ? r.skipped.filter((id) => id !== openId) : r.skipped;
      if (styleUndoBatch.current === batchId) styleUndoBatch.current = null;
      // Không hoàn tác được trang nào → không tự ẩn (toast Hoàn tác đã mất, dễ bỏ lỡ).
      const restored = r.pages + (local ? 1 : 0);
      setUndoneBatch(batchId);
      notify({
        tone: restored ? "info" : "warn",
        text: undoStyleText(restored, skipped, pages, openId, batchLabels.current.get(batchId)),
      });
    },
    onError: (e, batchId, prev) => {
      // Trả nút Hoàn tác của toast về cho mọi lỗi trừ 404 (lượt không còn): lỗi tạm thử lại được, và Áp kiểu không có nút khác.
      if (!(e instanceof ApiError && e.status === 404) && prev) setStyleUndo(prev);
      // Lượt không còn (404): bỏ mốc, không thì Cmd+Z kẹt mãi ở mốc này. Lỗi tạm (chương đang bận 409, mất khoá 423, mạng,
      // 5xx): giữ mốc và lịch sử trước lượt để thử lại khi hết lỗi.
      if (e instanceof ApiError && e.status === 404) {
        session.session.dropBatch(batchId);
        setUndoneBatch(batchId);
      }
      notify({
        tone: "danger",
        text:
          e instanceof ApiError
            ? describeWriteError(e.status, typeof e.body.error === "string" ? e.body.error : undefined, errorMessage(e))
            : errorMessage(e),
      });
    },
    onSettled: () => {
      releaseUndo();
      data.refresh();
    },
  });
  // Cmd+Z / nút Hoàn tác: bước cuối là mốc lượt sửa nhiều trang → hoàn tác cả lượt (như toast); không thì undo thường.
  const undoEdit = () => {
    const s = editorStore.getState();
    if (!s.doc || s.readOnly) return;
    const batch = batchOnTop(s.history);
    if (!batch) return s.undo();
    // Đang hoàn tác lượt (nút toast đã ẩn): bỏ phím lặp, đừng gọi lần 2.
    runUndo(batch.id);
  };
  const redoEdit = () => {
    if (!undoBusy.current) editorStore.getState().redo();
  };
  const applyKind = useMutation({
    mutationFn: async (row: Row): Promise<Notice> => {
      const s = editorStore.getState();
      const src = s.doc?.text_boxes.find((b) => b.id === row.boxId);
      if (!s.doc || !s.layout || !src) return { tone: "danger", text: "Chưa chọn khung chữ." };
      const { font_family, font_size, line_height, pad, align, valign, fill, stroke, auto_fit } = src;
      // Box tự khớp: cỡ chữ là kết quả khớp của riêng box đó — không chép sang box khác.
      const style = {
        font_family,
        line_height,
        pad,
        align,
        valign: valign ?? "top",
        fill,
        stroke,
        auto_fit,
        ...(auto_fit ? {} : { font_size }),
      };
      const layout = s.layout;
      const srcPage = s.pageId;
      const counts = new Map<string, number>();
      const r = await session.session.editMany((st, pageId) => {
        const ids = sameKindBoxIds(st, row.kind, pageId === srcPage ? src.id : null);
        counts.set(pageId, ids.length);
        return ids.length ? setStyleMany(ids, style, layout) : null;
      });
      const label = KIND_LABEL[row.kind].toLowerCase();
      if (r) styleUndoBatch.current = r.batchId;
      if (!r) return { tone: "info", text: `Mọi khối ${label} trong chương đã cùng kiểu này.` };
      const boxes = r.pageIds.reduce((n, id) => n + (counts.get(id) ?? 0), 0);
      return {
        tone: "info",
        text: `Đã áp kiểu cho ${boxes} khối ${label} trên ${r.pageIds.length} trang.`,
        actions: [{ label: "Hoàn tác", run: () => runUndo(r.batchId) }],
      };
    },
    onSuccess: (n) => {
      // Lượt mới thay toast hoàn tác cũ; kết quả không có lượt (đã cùng kiểu) thì giữ nguyên toast cũ.
      if (n.actions) setStyleUndo(n);
      notify(n.actions ? null : n);
    },
    onError: (e) =>
      notify({
        tone: "danger",
        text:
          e instanceof ApiError && e.body.error === "version_conflict"
            ? "Có trang vừa thay đổi (AI hoặc tab khác) — đã tải lại, bấm Áp kiểu lần nữa."
            : e instanceof ApiError && e.body.error === "chapter_busy"
              ? "Chương đang xử lý — chờ xong rồi áp kiểu cho cả chương."
              : errorMessage(e),
      }),
    onSettled: (_r, e) => {
      if (e) data.refresh();
    },
  });

  const { mutate: runAction } = action;
  const translateSelected = useCallback(() => runAction("translate-pages"), [runAction]);

  const onCommand = (cmd: ChapterCommand, opener?: HTMLElement | null) => {
    if (cmd === "export") {
      setExportOpener(opener ?? null);
      return setDrawer((d) => (d === "export" ? null : "export"));
    }
    if (cmd === "upload") return;
    action.mutate(cmd);
  };
  const [resumeError, setResumeError] = useState<string | null>(null);
  const resume = (files: File[]) => {
    setResumeError(null);
    resumeFromFiles(chapterId, files).catch((e: unknown) => setResumeError(errorMessage(e)));
  };
  const flush = useCallback(() => session.saver.flush(), [session.saver]);

  const back = async () => {
    await session.saver.flush();
    void navigate({ to: "/s/$seriesId", params: { seriesId } });
  };

  // ---- Ảnh gốc khi chưa có page (rail + canvas) ----
  // Chờ có tiến độ (danh sách page) mới quyết: chi tiết về trước thì chương đã có page cũng chớp sang ảnh gốc.
  const sourceMode = !!data.progress && pages.length === 0;
  const sources = useSourceImages(chapterId, sourceMode);
  const [sourcePick, setSourcePick] = useState<string | null>(null);
  const sourceId = sources.some((it) => it.id === sourcePick) ? sourcePick : (sources[0]?.id ?? null);
  const sourceIdx = sources.findIndex((it) => it.id === sourceId);
  const sourcesEditable = status === "draft" || (status === "partial_failed" && pages.length === 0);
  // Đang cắt trang → cột ảnh gốc hiện bước + đếm của job ingest (progress null = còn xếp hàng).
  const ingestJob = data.progress?.jobs.find((j) => j.type === "chapter.ingest" && j.status === "running");
  const ingest: IngestView | undefined =
    status !== "ingesting"
      ? undefined
      : ingestJob
        ? {
            stage: ingestJob.stage,
            progress: Math.min(1, Math.max(0, ingestJob.progress)),
            done: ingestJob.progress_done,
            total: ingestJob.progress_total,
            label: stageLabel(ingestJob) ?? "Đang cắt trang",
          }
        : { stage: null, progress: null, done: null, total: null, label: "Chờ cắt trang…" };
  // Chưa có page thì chỉ dùng được công cụ Chọn (rail tắt các công cụ còn lại; chỉ xem ảnh gốc).
  useEffect(() => {
    if (sourceMode && editorStore.getState().tool !== "select") editorStore.getState().setTool("select");
  }, [sourceMode]);
  // "Luôn bỏ ở series này" (toast sau khi xoá ảnh / trang): học ảnh credit → chương sau tự bỏ ảnh giống.
  const learnSkip = useMutation({
    mutationFn: (from: { source_file_id: string } | { page_id: string }) => learnSkipImage(seriesId, from),
    // Thay toast có nút ngay khi bấm → không bấm 2 lần.
    onMutate: () => notify({ tone: "info", text: "Đang lưu ảnh tự bỏ…" }),
    onSuccess: (r) => {
      notify({
        tone: "info",
        text: r.learned
          ? `Đã học ${r.learned} ảnh — chương sau của series tự bỏ ảnh giống.`
          : "Ảnh này đã có trong danh sách tự bỏ của series.",
      });
      void queryClient.invalidateQueries({ queryKey: seriesKeys.skipImages(seriesId) });
    },
    // Ảnh chưa tải lên xong (thường là ảnh cuối, xoá ngay khi thả) → giữ nút thử lại thay vì mất hẳn lựa chọn.
    onError: (e, from) =>
      notify({
        tone: "danger",
        text: errorMessage(e),
        ...(e instanceof ApiError && e.body.error === "not_uploaded"
          ? { actions: [{ label: "Thử lại", run: () => learnSkip.mutate(from) }] }
          : {}),
      }),
  });
  const alwaysSkip = useCallback(
    (from: { source_file_id: string } | { page_id: string }) => ({
      label: "Luôn bỏ ở series này",
      run: () => learnSkip.mutate(from),
    }),
    [learnSkip.mutate],
  );
  const sourceSkip = useSetSourceSkip(chapterId, (e) => notify({ tone: "danger", text: errorMessage(e) }));
  const skipSource = useCallback(
    (it: SourceItem, skip: "user" | null) =>
      sourceSkip.mutate(
        { id: it.id, skip },
        {
          onSuccess: () => {
            if (skip) {
              notify({
                tone: "info",
                key: "skip",
                text: `Đã xoá ảnh ${it.n}.`,
                actions: [
                  { label: "Hoàn tác", run: () => skipSource(it, null) },
                  alwaysSkip({ source_file_id: it.id }),
                ],
              });
            } else setNotice((n) => (n?.key === "skip" ? null : n));
          },
        },
      ),
    [sourceSkip.mutate, notify, alwaysSkip],
  );
  const sourceReorder = useReorderSources(chapterId, (e) => notify({ tone: "danger", text: errorMessage(e) }));
  /** Đưa ảnh `id` tới vị trí `to` (0-based); toast "Hoàn tác" trả đúng thứ tự trước đó. */
  const moveSource = useCallback(
    (id: string, to: number) => {
      const before = sources.map((it) => it.id);
      const ids = moveItem(before, before.indexOf(id), to);
      if (ids === before) return;
      sourceReorder.mutate(
        { ids },
        {
          onSuccess: () =>
            notify({
              tone: "info",
              key: "reorder",
              text: "Đã đổi thứ tự.",
              actions: [
                {
                  label: "Hoàn tác",
                  run: () =>
                    sourceReorder.mutate(
                      { ids: before },
                      { onSuccess: () => setNotice((n) => (n?.key === "reorder" ? null : n)) },
                    ),
                },
              ],
            }),
        },
      );
    },
    [sources, sourceReorder.mutate, notify],
  );
  // ---- Xoá (ẩn) / khôi phục trang đã cắt ----
  // Ẩn/khôi phục trang chỉ khi chương ổn định (server trả 409 `chapter_busy` lúc đang chạy).
  const pagesEditable = settled && session.lockEnabled && session.lock.state.status === "held";
  const pageSkip = useMutation({
    mutationFn: ({ page, skipped }: { page: ProgressPage; skipped: boolean }) => setPageSkip(page.id, skipped),
    onSuccess: (_r, { page, skipped }) => {
      if (skipped) {
        notify({
          tone: "info",
          key: "skip",
          text: `Đã ẩn trang ${page.ord + 1} (không dịch, không xuất).`,
          actions: [
            { label: "Hoàn tác", run: () => pageSkip.mutate({ page, skipped: false }) },
            alwaysSkip({ page_id: page.id }),
          ],
        });
      } else setNotice((n) => (n?.key === "skip" ? null : n));
    },
    onError: (e) => notify({ tone: "danger", text: errorMessage(e) }),
    onSettled: data.refresh,
  });
  const skipPage = useCallback(
    (page: ProgressPage, skipped: boolean) => {
      // Ẩn trang đang sửa → chuyển sang trang kế (hoặc trước) trước, để lưu chỉnh sửa dở của trang đó.
      if (skipped && page.id === editorStore.getState().pageId) {
        const i = pages.findIndex((p) => p.id === page.id);
        go((pages[i + 1] ?? pages[i - 1])?.id);
      }
      pageSkip.mutate({ page, skipped });
    },
    [pages, go, pageSkip.mutate],
  );

  // Menu trang: dịch / dịch lại riêng 1 trang, bỏ chỉnh sửa tay trang đang mở (hoàn tác được bằng toast hoặc Ctrl/Cmd+Z).
  const retranslateOne = useCallback((page: ProgressPage) => runAction({ retranslatePage: page }), [runAction]);
  const canResetEdits = useCallback((page: ProgressPage) => {
    const s = editorStore.getState();
    if (page.id !== s.pageId || !s.doc || !s.ai.state || s.readOnly) return false;
    return (
      JSON.stringify([s.doc.regions, s.doc.text_boxes]) !== JSON.stringify([s.ai.state.regions, s.ai.state.text_boxes])
    );
  }, []);
  const resetEdits = useCallback(
    (page: ProgressPage) => {
      const s = editorStore.getState();
      const ai = s.ai.state;
      if (page.id !== s.pageId || !ai || s.readOnly) return;
      const before = s.doc;
      s.apply(resetToAI(ai));
      const after = editorStore.getState().doc;
      // Nút Hoàn tác chỉ hoàn tác đúng bước này. Còn ở đúng trang này và nó vẫn là bước cuối thì undo. Đã sang trang khác
      // thì trang đó đã lưu bản AI: đưa các sửa tay về qua đường khôi phục trang không active (rebase lên bản server, ghi
      // thẳng) — không đụng trang đang mở. Đã sửa tiếp / hoàn tác bằng phím ở đúng trang này thì thôi.
      // Bấm xong là đóng thông báo nên không bấm lần hai được.
      const step = editorStore.getState().history.past.at(-1);
      const restoreSaved = async () => {
        if (!before || !after) return;
        try {
          const how = await session.session.restoreOther({
            pageId: page.id,
            baseVersion: chapterStore.getState().cache[page.id]?.version ?? 0,
            ops: diffStates(after, before),
            updatedAt: Date.now(),
          });
          notify({
            tone: how === "deferred" ? "warn" : "info",
            text:
              how === "deferred"
                ? `Trang ${page.ord + 1} đang bận hoặc có thay đổi khác: sửa tay sẽ được khôi phục khi bạn mở trang này.`
                : `Đã khôi phục sửa tay trên trang ${page.ord + 1}.`,
          });
        } catch (e) {
          notify({ tone: "danger", text: `Không khôi phục được sửa tay trang ${page.ord + 1}: ${errorMessage(e)}` });
        }
      };
      notify({
        tone: "info",
        text: `Đã bỏ chỉnh sửa tay trên trang ${page.ord + 1}, dùng lại bản AI.`,
        actions: [
          {
            label: "Hoàn tác",
            run: () => {
              const now = editorStore.getState();
              notify(null);
              if (now.pageId !== page.id) void restoreSaved();
              else if (step && now.history.past.at(-1) === step) now.undo();
              else notify({ tone: "info", text: "Đã sửa tiếp sau bước này — dùng Cmd+Z (Ctrl+Z) để lùi từng bước." });
            },
          },
        ],
      });
    },
    [notify, session.session],
  );

  const stepSourceBy = (dir: -1 | 1) => {
    const next = stepSource(sources, sourceId, dir);
    if (next) setSourcePick(next);
  };

  // ---- Ảnh + OCR của page active ----
  const slotImages = useMemo(() => {
    const m = new Map<string, SlotImages>();
    for (const [id, p] of data.images)
      m.set(id, { original: p.images.original, clean: p.images.clean, cleanRev: p.clean_rev });
    return m;
  }, [data.images]);
  // Page đang chạy AI → canvas hiện ảnh gốc + nhãn (page chờ dịch hiện ảnh sạch để soát); khoá theo chữ ký để lần poll tiến độ không đổi gì thì không vẽ lại.
  const processingSig = pages
    .map((p) => {
      const level = pageLevel(p.status);
      return level === "busy" ? `${p.id}=${level}` : "";
    })
    .filter(Boolean)
    .join(",");
  const processing = useMemo(
    () => new Map(processingSig ? processingSig.split(",").map((e) => e.split("=") as [string, SlotProcessing]) : []),
    [processingSig],
  );
  const idx = pages.findIndex((p) => p.id === activeId);
  const activeMeta = pages[idx];
  const defaultFont = kit
    ? dialogueFont(kit.manifest, series.data?.default_fonts.dialogue, kit.knows)
    : "Bangers-Regular";
  const [autoErase, setAutoErase] = useState(readAutoErase);
  const toggleAutoErase = (on: boolean) => {
    setAutoErase(on);
    writeAutoErase(on);
  };
  const ocr = useOcrRegion(
    activeId ?? "",
    defaultFont,
    { w: activeMeta?.width ?? 0, h: activeMeta?.height ?? 0 },
    {
      enabled: autoErase,
      cleanRevOf: (id) => pages.find((p) => p.id === id)?.clean_rev ?? null,
      onErased: data.refresh,
    },
  );
  const ocrStart = ocr.start;
  const onOcr = useCallback((r: PageRect) => void ocrStart(r), [ocrStart]);
  /** "Dịch lại khối" = nhận dạng + dịch lại vùng OCR của khối (khối tự thêm không có vùng → bỏ qua). */
  const reocrRow = (row: Pick<Row, "regionId">) => {
    const [x, y, w, h] = editorStore.getState().doc?.regions.find((r) => r.id === row.regionId)?.bbox ?? [];
    if (row.regionId && w && h) void ocr.start({ x: x ?? 0, y: y ?? 0, w, h }, row.regionId);
  };

  const errors = [
    session.fontError,
    session.error,
    imageError,
    ocr.error,
    ocr.eraseError,
    data.error ? errorMessage(data.error) : null,
  ];
  const isDraft = status === "draft";
  const ingestError = data.progress?.jobs.find((j) => j.type === "chapter.ingest" && j.error)?.error ?? null;
  const canTools = settled && pages.length > 0;
  const aiWaitInfo = providerWait(pages);
  const aiWait = aiWaitInfo ? { short: providerWaitShort(aiWaitInfo), long: providerWaitText(aiWaitInfo) } : null;

  const readOnly = useEditor((s) => !!s.readOnly);
  const readOnlyReason = useEditor((s) => s.readOnly);
  const conflictCount = useEditor((s) => s.conflicts.length);
  const aiUpdate = useEditor(hasAiUpdate);
  // Dịch lại trang khác vẫn được khi trang đang mở bận; các lý do chỉ xem còn lại (khoá, đang tải, khôi phục) thì không.
  const retranslateOff =
    readOnlyReason && readOnlyReason !== "page_busy" && readOnlyReason !== "processing"
      ? "Đang chỉ xem"
      : action.isPending
        ? "Đang gửi yêu cầu…"
        : undefined;
  const railDisabled: Partial<Record<RailTarget, string>> = {};
  for (const t of ["text", "brush", "ocr"] as const) {
    if (sourceMode) railDisabled[t] = "Dùng được khi chương đã cắt trang";
    else if (readOnly) railDisabled[t] = "Đang chỉ xem";
  }
  // Tab Tìm / Thay, Glossary, Hiệu đính cần chương đã dịch; đang ở tab đó mà chương chạy lại thì về Bản dịch.
  const docDisabled: Partial<Record<DocTab, string>> = canTools
    ? {}
    : {
        find: "Dùng được khi chương dịch xong",
        glossary: "Dùng được khi chương dịch xong",
        proofread: "Dùng được khi chương đã dịch",
      };
  const tab: DocTab = docDisabled[docTab] ? "table" : docTab;
  const pendingProofread = usePendingProofread(chapterId, allRows, canTools && seenTabs.size > 0);
  useEffect(() => {
    if (panel === "doc") setSeenTabs((s) => (s.has(tab) ? s : new Set(s).add(tab)));
  }, [panel, tab]);
  /** Mở panel Văn bản ở tab `t` (Ctrl+F, "Xem N chỗ này" của menu Xuất, chuyển tab). */
  const showDoc = (t: DocTab) => {
    setDocTab(t);
    setPanel("doc");
  };
  const toolOpen = panel === "tool";
  const onRail = (t: RailTarget) => {
    const st = editorStore.getState();
    const next = railClick({ panel, tool }, t, {
      content: hasToolContent(st),
      selection: !!st.selection || !!currentRow,
    });
    if (next.tool !== tool) editorStore.getState().setTool(next.tool);
    collapsedByTool.current = panel === "tool" && next.panel === null && next.tool !== "select";
    setPanel(next.panel);
  };

  // Panel khối đè lên mép trái canvas: báo bề ngang nó che để khung nhìn được lệch thêm chừng đó (không bị kẹp về giữa
  // khi cuộn), và cuộn lộ khối đang chọn nếu nằm dưới panel. Đo theo khung canvas thật (`chapterStore.box`) và bề
  // ngang panel thật, không dùng số cố định.
  const panelEl = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    chapterStore.getState().setCover(toolOpen ? (panelEl.current?.offsetWidth ?? 0) : 0);
    return () => chapterStore.getState().setCover(0);
  }, [toolOpen]);
  useEffect(() => {
    if (!toolOpen) return;
    // Khối vừa chọn có thể đang bắt đầu kéo: cuộn giữa chừng làm khối lệch khỏi chỗ thả → đợi nhả chuột.
    const schedule = () => {
      if (pointerDown.current) addEventListener("pointerup", revealSelection, { once: true });
      else revealSelection();
    };
    schedule();
    const unsubSel = editorStore.subscribe((s, prev) => {
      if (s.selection && s.selection !== prev.selection) schedule();
    });
    return unsubSel;
  }, [toolOpen]);

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
        // Chưa có page: chỉ công cụ Chọn (rail cũng tắt các công cụ khác).
        // Chỉ xem: cũng chỉ Chọn (rail tắt các công cụ khác, docs/editor.md).
        if ((sourceMode || s.readOnly) && a.tool !== "select") return;
        return void s.setTool(a.tool);
      case "holdOriginalStart":
        return void cs.setHoldOriginal(true);
      case "holdOriginalEnd":
        return void cs.setHoldOriginal(false);
      case "toggleOriginal":
        return void cs.setViewMode(cs.viewMode === "original" ? "translated" : "original");
      case "page":
        if (sourceMode) stepSourceBy(a.dir);
        else go(pages[idx + a.dir]?.id);
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
        return void undoEdit();
      case "redo":
        return void redoEdit();
      case "save":
        void session.saver.flush();
        return;
      case "find":
        if (!canTools) return false;
        showDoc("find");
        setFocusReq((r) => ({ seq: (r?.seq ?? 0) + 1, selector: "#fr-find" }));
        return;
      case "editText":
        if (s.selection && !s.readOnly) s.setEditing(s.selection);
        return;
      case "deleteBox":
        if (s.selection) s.apply(deleteBox(s.selection));
        return;
      case "escape":
        // Esc bỏ cả chọn trang (cột trang) lẫn chọn khối.
        setPageSel(EMPTY_SELECTION);
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
  const exportList = useExports(chapterId).q.data?.exports;
  const exportsActive = (exportList ?? []).filter((x) => isExportActive(x.status)).length;
  // Lượt xuất xong lúc menu Xuất đóng (menu không còn tự tải) → thông báo kèm nút tải. Lượt đã xong lúc mở
  // màn chương (lần tải danh sách đầu) không báo lại.
  const exportsDone = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!exportList) return;
    const done = exportList.filter((x) => x.status === "succeeded");
    const seen = exportsDone.current;
    exportsDone.current = new Set(done.map((x) => x.id));
    if (!seen || drawerRef.current === "export") return;
    const fresh = done.find((x) => !seen.has(x.id) && x.download_url);
    const url = fresh?.download_url;
    if (url) {
      notify({
        tone: "info",
        sticky: true,
        text: "Đã xuất xong.",
        actions: [{ label: "Tải xuống", run: () => triggerDownload(url) }],
      });
    }
  }, [exportList, notify]);
  const activityCount = uploadCount + chapterActivityCount(data.progress, exportsActive);
  // Chip nói cả lượt xuất của chương và upload chương khác (upload của chính chương này đã có trong chip).
  const topChip =
    chip &&
    chipWithActivity(chip, {
      exports: exportsActive,
      uploads: Math.max(0, uploadCount - (upload?.phase === "uploading" ? 1 : 0)),
    });
  // Chương đang chạy thì chip dẫn tới Hoạt động; yên mà còn trang cần xem thì nhảy tới trang đó (qua đổi trang
  // thường: lưu trang đang sửa trước).
  const reviewTarget =
    chip && chip.tone !== "busy" ? nextReviewPage(pageIds, activeId, (id) => reviewIds.has(id)) : null;
  const onChip = () => {
    if (reviewTarget) pickPage(reviewTarget);
    else setDrawer("activity");
  };
  const closeDrawer = useCallback(() => setDrawer(null), []);

  return (
    <div className="cw" data-cover={toolOpen || undefined}>
      <ChapterTopbar
        seriesId={seriesId}
        series={series.data}
        detail={data.detail}
        chip={topChip}
        chipJumps={!!reviewTarget}
        onChip={onChip}
        progress={chipInput ? chapterProgress(chipInput) : undefined}
        access={access}
        primary={primary}
        pending={action.isPending}
        onCommand={onCommand}
        onUploadFiles={resume}
        onBack={() => void back()}
        onMoved={(to) =>
          void navigate({
            to: "/s/$seriesId/c/$chapterId",
            params: { seriesId: to, chapterId },
            search: searchPage ? { page: searchPage } : {},
            replace: true,
          })
        }
        activityCount={activityCount}
        onActivity={() => setDrawer("activity")}
        onHelp={() => setDrawer("help")}
        onUndo={undoEdit}
        onRedo={redoEdit}
      />
      <LockBand
        access={access}
        onRetryLock={() => void session.lock.retry()}
        recovery={session.recovery}
        canRestore={session.lock.state.status === "held" && session.lockEnabled}
        onRecovery={(accept) => void session.restore(accept)}
        aiWait={aiWait}
        hiddenConflicts={panel === null ? conflictCount : 0}
        hiddenAi={panel !== "tool" && aiUpdate}
        onShowHidden={() => setPanel("tool")}
      />
      <ToolRail panel={panel} tool={tool} disabled={railDisabled} onClick={onRail} />
      <ContextPanel
        title={PANEL_TITLE[panel ?? "tool"]}
        heading={toolOpen && currentRow ? `Khối ${currentRow.index}/${activeBlocks}` : undefined}
        actions={
          toolOpen && currentRow ? (
            <BlockActions row={currentRow} ocrBusy={ocr.pending.length > 0} onReocr={reocrRow} />
          ) : undefined
        }
        open={panel !== null}
        wide={isWidePanel(panel)}
        overlay={toolOpen}
        elRef={panelEl}
        onClose={() => {
          // Nút thu nằm trong panel sắp ẩn → đưa focus về nút rail của panel đó (không rơi về <body>).
          document.querySelector<HTMLButtonElement>('.cw-toolrail [aria-pressed="true"]')?.focus();
          collapsedByTool.current = false;
          // Thu Văn bản khi còn nội dung phải xử lý (AI mới, xung đột) → về panel khối thay vì giấu nội dung đó.
          setPanel(panel === "doc" && hasToolContent(editorStore.getState()) ? "tool" : null);
        }}
        focus={focusReq}
      >
        {/* Xung đột khi lưu hiện trên mọi panel (đổi trang là mất danh sách → không được giấu sau panel khác). */}
        <div className="cw-panel-conflicts">
          <ConflictList />
        </div>
        {toolOpen && (
          <div className="cw-panel-tool">
            <SelectPanel
              page={sourceMode ? undefined : activeMeta}
              row={currentRow}
              kit={kit}
              targetLang={series.data?.target_lang}
              defaultFonts={series.data?.default_fonts}
              busy={{ ocr: ocr.pending.length > 0, applyKind: applyKind.isPending }}
              ocrRetry={ocr.retry}
              onCancelOcr={ocr.cancel}
              onApplyKind={(row) => applyKind.mutate(row)}
            />
          </div>
        )}
        {/* Mỗi tab đã mở giữ mount (chỉ ẩn khi chuyển): bảng Bản dịch, kết quả xem trước Tìm/Thay (hộp xác nhận Hiệu đính đóng khi rời tab). */}
        {seenTabs.size > 0 && (
          <div className="cw-panel-doc" hidden={panel !== "doc"}>
            <DocTabs tab={tab} disabled={docDisabled} pendingProofread={pendingProofread} onSelect={setDocTab} />
            {seenTabs.has("table") && (
              <div
                className="cw-panel-table"
                role="tabpanel"
                id={docPanelId("table")}
                aria-labelledby={docTabId("table")}
                hidden={tab !== "table"}
              >
                <div className="cw-panel-tools">
                  <span className="small">{allRows.length} khối</span>
                  <TableFilters value={filter} onChange={setFilter} />
                </div>
                <TextTable rows={rows} total={allRows.length} current={current} activeId={activeId} onPick={pick} />
              </div>
            )}
            {seenTabs.has("find") && (
              <div
                className="cw-panel-find"
                role="tabpanel"
                id={docPanelId("find")}
                aria-labelledby={docTabId("find")}
                hidden={tab !== "find"}
              >
                {/* Giữ mount cả khi chương chạy lại (Dịch lại…): "Hoàn tác" của lần thay hàng loạt nằm trong state panel. */}
                <fieldset className="cw-find-part" aria-label="Tìm / Thay">
                  <FindReplacePanel
                    seriesId={seriesId}
                    chapterId={chapterId}
                    lock={session.lock}
                    beforeWrite={flush}
                    onJump={jump}
                    batch={batchHooks("thay thế")}
                  />
                </fieldset>
              </div>
            )}
            {seenTabs.has("glossary") && (
              <div
                className="cw-panel-find"
                role="tabpanel"
                id={docPanelId("glossary")}
                aria-labelledby={docTabId("glossary")}
                hidden={tab !== "glossary"}
              >
                <fieldset className="cw-find-part" aria-label="Áp glossary">
                  <ApplyGlossaryPanel
                    seriesId={seriesId}
                    chapterId={chapterId}
                    lock={session.lock}
                    beforeWrite={flush}
                    onJump={jump}
                    batch={batchHooks("áp glossary")}
                  />
                </fieldset>
              </div>
            )}
            {seenTabs.has("proofread") && (
              <div
                className="cw-panel-proofread"
                role="tabpanel"
                id={docPanelId("proofread")}
                aria-labelledby={docTabId("proofread")}
                hidden={tab !== "proofread"}
              >
                <ProofreadPanel
                  chapterId={chapterId}
                  status={status}
                  rows={allRows}
                  activeId={activeId}
                  onPick={pick}
                  beforeRun={flush}
                  active={panel === "doc" && tab === "proofread"}
                />
              </div>
            )}
          </div>
        )}
      </ContextPanel>
      <main className="cw-main">
        <Notices
          errors={errors}
          notice={notice}
          onDismiss={() => notify(null)}
          styleUndo={styleUndo}
          onDismissStyleUndo={() => setStyleUndo(null)}
        />
        {sourceMode ? (
          <div className="cw-source">
            <div className="cw-source-band">
              {isDraft ? (
                <>
                  <ChapterUploadStatus chapterId={chapterId} onResume={resume} resumeError={resumeError} />
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
                      ? `Cắt trang lỗi${ingestError ? `: ${ingestError}` : ""} — bấm "Cắt lại trang" để cắt lại từ ảnh đã tải.`
                      : "Chưa có trang."}
                </p>
              )}
            </div>
            <SourceViewer
              chapterId={chapterId}
              item={sources[sourceIdx]}
              index={sourceIdx}
              total={sourceCounts(sources).total}
              onStep={stepSourceBy}
            />
          </div>
        ) : (
          <div className="cw-canvas">
            {kit ? (
              <ChapterCanvas
                kit={kit}
                images={slotImages}
                processing={processing}
                defaultFont={defaultFont}
                ocrPending={ocr.pending}
                onOcr={onOcr}
                onImageError={setImageError}
                onActivate={activateAwait}
              />
            ) : (
              <div className="ed-canvas ed-loading">
                <span className="muted">Đang tải…</span>
              </div>
            )}
            {tool === "text" && <TextToolBar />}
            {tool === "ocr" && (
              <OcrToolBar
                pending={ocr.pending.length}
                retry={ocr.retry}
                onCancel={ocr.cancel}
                autoErase={autoErase}
                onAutoErase={toggleAutoErase}
                erasing={ocr.erasing}
              />
            )}
            {(tool === "brush" || tool === "eraser") && activeMeta && (
              <CanvasToolBar label="Tuỳ chọn Tẩy chữ">
                <MaskToolBar
                  pageId={activeMeta.id}
                  cleanRev={activeMeta.clean_rev}
                  page={{ w: activeMeta.width, h: activeMeta.height }}
                  onDone={data.refresh}
                />
              </CanvasToolBar>
            )}
            <CanvasPager onStep={(dir) => go(pages[idx + dir]?.id)} />
          </div>
        )}
      </main>
      {sourceMode ? (
        <SourceRail
          items={sources}
          activeId={sourceId}
          editable={sourcesEditable}
          ingest={ingest}
          onPick={setSourcePick}
          onSkip={skipSource}
          onMove={moveSource}
        />
      ) : (
        <PageRail
          pages={pages}
          hidden={data.hiddenPages}
          images={data.images}
          activeId={activeId}
          overflow={overflowPages}
          editable={pagesEditable && !pageSkip.isPending}
          onPick={pickPage}
          onSkip={skipPage}
          selected={selectedSet}
          translating={action.isPending}
          onSelect={onSelectPage}
          onTranslateSelected={translateSelected}
          onClearSelection={clearSelection}
          onRetranslate={retranslateOne}
          retranslateOff={retranslateOff}
          canResetEdits={canResetEdits}
          onResetEdits={resetEdits}
        />
      )}
      {drawer === "export" && (
        <ExportMenu
          chapterId={chapterId}
          detail={data.detail}
          pages={pages}
          rows={allRows}
          opener={exportOpener}
          beforeStart={flush}
          onShowWarnings={() => {
            setFilter({ review: true, page: false });
            showDoc("table");
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
function Notices(props: {
  errors: (string | null | undefined)[];
  notice: Notice | null;
  onDismiss(): void;
  styleUndo: Notice | null;
  onDismissStyleUndo(): void;
}) {
  const errors = [...new Set(props.errors.filter((e): e is string => !!e))];
  return (
    <div className="ed-notices cw-toasts" aria-live="polite">
      {props.styleUndo && <NoticeRow notice={props.styleUndo} onDismiss={props.onDismissStyleUndo} />}
      {props.notice && <NoticeRow notice={props.notice} onDismiss={props.onDismiss} />}
      {errors.map((e) => (
        <div key={e} className="notice danger" role="alert">
          {e}
        </div>
      ))}
    </div>
  );
}

function NoticeRow(props: { notice: Notice; onDismiss(): void }) {
  const { notice } = props;
  return (
    <div className={`notice ${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>
      {notice.text}{" "}
      {notice.actions?.map((a) => (
        <button key={a.label} type="button" className="btn-ghost" onClick={a.run}>
          {a.label}
        </button>
      ))}
      <button type="button" className="btn-ghost" onClick={props.onDismiss}>
        Đóng
      </button>
    </div>
  );
}
