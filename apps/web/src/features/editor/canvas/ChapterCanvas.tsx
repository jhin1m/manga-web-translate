/**
 * Canvas màn chương: hiện từng trang một — chỉ page đang sửa (active), vẽ qua transform `view` (toạ độ page) trên 1
 * Stage bằng khung nhìn (không bao giờ bằng page — giới hạn canvas Safari). Đổi trang ở cột trang / pager / phím ←/→.
 *
 * Chế độ xem (chapterStore): Gốc = ảnh gốc, ẩn chữ; Dịch = ảnh sạch + chữ; Chia đôi = thêm cột Gốc bên trái cùng
 * Stage (cuộn/zoom đồng bộ tự nhiên), chỉ cột Dịch nhận thao tác — bấm/kéo ở cột Gốc = kéo canvas.
 *
 * Mở chương / đổi trang / bật-tắt chia đôi: vừa khung theo chính page đó (`fitScale` — trọn page dạng tờ, trần
 * 100%), căn giữa ngang; đã tự zoom thì giữ zoom. Page đang chạy AI (`processing`) hiện ảnh gốc + nhãn trạng thái,
 * không vẽ chữ.
 *
 * Cuộn = cuộn trong page; Ctrl/Cmd+cuộn = zoom quanh con trỏ; Space giữ (hoặc chuột giữa) + kéo = kéo canvas.
 * Sửa chữ = textarea HTML phủ lên box.
 */
import type Konva from "konva";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Stage as KStage, Layer } from "react-konva";
import { addBox, editText, newTextBox } from "../actions.ts";
import { chapterStore, effectiveMode, useChapterStore } from "../chapter-store.ts";
import type { FontKit } from "../fonts.ts";
import { lineStep } from "../measure.ts";
import { clampView, contentBox, FIT_EDGE, fitScale, pageStartView, screenToPage } from "../page-layout.ts";
import { editorStore, useEditor, type View } from "../store.ts";
import { MaskLayer } from "./MaskLayer.tsx";
import { OcrOverlay, type PageRect } from "./OcrSelect.tsx";
import { PageSlot, type SlotImages, type SlotProcessing } from "./PageSlot.tsx";
import { TextLayer } from "./TextLayer.tsx";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;

const normRect = (a: { x: number; y: number }, b: { x: number; y: number }): PageRect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y),
});

const clipRect = (r: PageRect, page: { w: number; h: number }): PageRect => {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  return { x, y, w: Math.min(page.w, r.x + r.w) - x, h: Math.min(page.h, r.y + r.h) - y };
};

/** memo: tự đọc store bên trong; props ổn định → màn chương render lại (gõ ở bảng) không vẽ lại canvas. */
export const ChapterCanvas = memo(function ChapterCanvas(props: {
  kit: FontKit;
  images: Map<string, SlotImages>;
  /** Page đang chạy AI theo tiến độ chương (vắng mặt = chờ dịch, xong hoặc lỗi). */
  processing: ReadonlyMap<string, SlotProcessing>;
  defaultFont: string;
  ocrPending: PageRect[];
  onOcr(r: PageRect): void;
  onImageError(msg: string | null): void;
}) {
  const { kit } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const pages = useChapterStore((s) => s.pages);
  const view = useEditor((s) => s.view);
  const tool = useEditor((s) => s.tool);
  const showOriginal = useChapterStore((s) => effectiveMode(s) === "original");
  const split = useChapterStore((s) => s.viewMode === "split");
  const activeId = useEditor((s) => s.pageId);
  const [draft, setDraft] = useState<PageRect | null>(null);
  const [space, setSpace] = useState(false);
  const gesture = useRef<{
    kind: "pan" | "rect" | "paint";
    sx: number;
    sy: number;
    start: View;
    from: { x: number; y: number };
  } | null>(null);
  const [fitted, setFitted] = useState(false);
  /** Khung nhìn do lần vừa khung gần nhất đặt; khung nhìn hiện tại khác nó = người dùng đã cuộn/zoom/đổi trang. */
  const lastFit = useRef<View | null>(null);

  const active = pages.find((p) => p.id === activeId);
  const pw = active?.width ?? 0;
  const ph = active?.height ?? 0;
  const page = useMemo(() => ({ w: pw, h: ph }), [pw, ph]);
  const content = contentBox(page, split);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (!e) return;
      const box = { w: e.contentRect.width, h: e.contentRect.height };
      setSize(box);
      chapterStore.getState().setBox(box);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Lần đầu có page active + khung đã đo: vừa khung theo page đó. Khung đổi cỡ khi chưa ai động vào khung nhìn
  // (panel ngữ cảnh mở/thu sau lần đo đầu) → vừa lại. Đổi trang sau đó do chapterStore.setActive đặt khung nhìn.
  useEffect(() => {
    if (size.w === 0 || page.w === 0) return;
    if (fitted && editorStore.getState().view !== lastFit.current) return;
    const v = pageStartView(page, chapterStore.getState().viewMode === "split", size);
    lastFit.current = v;
    editorStore.getState().setView(v);
    setFitted(true);
  }, [fitted, size, page]);

  // Khung đổi cỡ sau khi người dùng đã động vào khung nhìn (thu/mở panel, panel 288 ↔ 560, đổi trang rồi mới đổi cỡ):
  // chưa tự zoom → vừa lại theo bề rộng mới, giữ điểm page đang ở mép trên; đã zoom → giữ mức, chỉ kẹp/căn giữa lại.
  const lastSize = useRef(size);
  useEffect(() => {
    const prev = lastSize.current;
    lastSize.current = size;
    if (prev.w === size.w && prev.h === size.h) return;
    const v = editorStore.getState().view;
    // Chưa vừa lần đầu / chưa ai động vào khung nhìn → effect vừa khung ở trên lo.
    if (!fitted || size.w === 0 || page.w === 0 || v === lastFit.current) return;
    const c = contentBox(page, chapterStore.getState().viewMode === "split");
    if (chapterStore.getState().zoomed) {
      editorStore.getState().setView(clampView(v, c, size, c.x));
      return;
    }
    const topY = (FIT_EDGE - v.y) / v.scale;
    const scale = fitScale(c, page, size, MIN_SCALE);
    editorStore.getState().setView(clampView({ scale, x: 0, y: FIT_EDGE - topY * scale }, c, size, c.x));
  }, [fitted, size, page]);

  // Bật/tắt chia đôi: vừa lại theo nội dung mới (trừ khi đã tự zoom), giữ điểm page đang ở giữa khung.
  const lastSplit = useRef(split);
  useEffect(() => {
    if (lastSplit.current === split) return;
    lastSplit.current = split;
    if (!fitted || size.w === 0 || page.w === 0) return;
    const v = editorStore.getState().view;
    const c = contentBox(page, split);
    const midY = (size.h / 2 - v.y) / v.scale;
    const scale = chapterStore.getState().zoomed ? v.scale : fitScale(c, page, size, MIN_SCALE);
    editorStore.getState().setView(clampView({ scale, x: 0, y: size.h / 2 - midY * scale }, c, size, c.x));
  }, [fitted, split, size, page]);

  useEffect(() => {
    const isField = (t: EventTarget | null) =>
      t instanceof HTMLElement && t.closest("input, textarea, select, [contenteditable]");
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isField(e.target) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpace(false);
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
    };
  }, []);

  const setView = (v: View) => editorStore.getState().setView(clampView(v, content, size, content.x));
  /** Toạ độ màn hình → toạ độ trong page active. */
  const toPage = (p: { x: number; y: number }) => screenToPage(p, view);

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const { deltaX, deltaY, ctrlKey, metaKey, shiftKey } = e.evt;
    if (ctrlKey || metaKey) {
      chapterStore.getState().setZoomed(true);
      const p = e.target.getStage()?.getPointerPosition() ?? { x: size.w / 2, y: size.h / 2 };
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * Math.exp(-deltaY * 0.0015)));
      const at = toPage(p);
      setView({ scale, x: p.x - at.x * scale, y: p.y - at.y * scale });
    } else if (shiftKey) setView({ ...view, x: view.x - deltaY });
    else setView({ ...view, x: view.x - deltaX, y: view.y - deltaY });
  };

  const onDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const stage = e.target.getStage();
    const p = stage?.getPointerPosition();
    if (!stage || !p) return;
    const s = editorStore.getState();
    const base = { sx: p.x, sy: p.y, start: view, from: toPage(p) };
    // Cột Gốc khi chia đôi chỉ để xem: kéo = kéo canvas.
    if (space || e.evt.button === 1 || (split && e.evt.button === 0 && base.from.x < 0)) {
      gesture.current = { kind: "pan", ...base };
      return;
    }
    if (e.evt.button !== 0) return;
    if (tool === "select") {
      if (
        e.target === stage ||
        e.target.getLayer()?.listening() === false ||
        e.target.getParent()?.listening() === false
      ) {
        s.select(null);
      }
      return;
    }
    if (s.readOnly || !active) return;
    if (tool === "brush" || tool === "eraser") {
      gesture.current = { kind: "paint", ...base };
      const stroke = {
        mode: tool === "brush" ? ("paint" as const) : ("erase" as const),
        size: s.mask.size,
        points: [base.from.x, base.from.y],
      };
      s.setMask({ strokes: [...s.mask.strokes, stroke] });
      return;
    }
    gesture.current = { kind: "rect", ...base };
    setDraft({ ...base.from, w: 0, h: 0 });
  };

  const onMove = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const g = gesture.current;
    const p = e.target.getStage()?.getPointerPosition();
    if (!g || !p) return;
    if (g.kind === "pan") return setView({ ...g.start, x: g.start.x + p.x - g.sx, y: g.start.y + p.y - g.sy });
    const at = toPage(p);
    if (g.kind === "rect") return setDraft(normRect(g.from, at));
    const s = editorStore.getState();
    const strokes = s.mask.strokes.slice();
    const last = strokes.at(-1);
    if (!last) return;
    strokes[strokes.length - 1] = { ...last, points: [...last.points, at.x, at.y] };
    s.setMask({ strokes });
  };

  const onUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind !== "rect" || !draft || !active) return;
    setDraft(null);
    const s = editorStore.getState();
    const page = { w: active.width, h: active.height };
    if (tool === "ocr") {
      if (draft.w >= 8 && draft.h >= 8) props.onOcr(clipRect(draft, page));
      return;
    }
    if (tool === "text" && s.layout) {
      const r = draft.w < 16 || draft.h < 16 ? { x: draft.x - 80, y: draft.y - 30, w: 160, h: 60 } : draft;
      const id = `tb-${crypto.randomUUID().slice(0, 8)}`;
      s.apply(addBox(newTextBox(id, r, props.defaultFont, null)));
      s.setTool("select");
      s.select(id);
      s.setEditing(id);
    }
  };

  // Vùng nhìn theo toạ độ page.
  const viewport = { x: -view.x / view.scale, y: -view.y / view.scale, w: size.w / view.scale, h: size.h / view.scale };
  // Đã xem ảnh gốc 1 lần → giữ layer gốc của page đang hiện (bật/tắt không tải lại).
  const [originalSeen, setOriginalSeen] = useState(false);
  if (showOriginal && !originalSeen) setOriginalSeen(true);
  const cursor = space ? "grab" : tool === "select" ? "default" : "crosshair";

  return (
    <div ref={wrapRef} className="ed-canvas" style={{ cursor }}>
      {size.w > 0 && (
        <KStage
          width={size.w}
          height={size.h}
          scaleX={view.scale}
          scaleY={view.scale}
          x={view.x}
          y={view.y}
          onWheel={onWheel}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        >
          {active && (
            <Layer listening={false}>
              {split && (
                <PageSlot
                  key={`orig:${active.id}`}
                  pageId={active.id}
                  size={page}
                  x={content.x}
                  images={props.images.get(active.id)}
                  viewport={{ ...viewport, x: viewport.x - content.x }}
                  scale={view.scale}
                  showOriginal
                  keepOriginal={false}
                  onImageError={props.onImageError}
                />
              )}
              <PageSlot
                key={active.id}
                pageId={active.id}
                size={page}
                images={props.images.get(active.id)}
                viewport={viewport}
                scale={view.scale}
                showOriginal={showOriginal}
                processing={props.processing.get(active.id)}
                keepOriginal={originalSeen && !split}
                onImageError={props.onImageError}
              />
            </Layer>
          )}
          {!showOriginal && active && !props.processing.has(active.id) && <TextLayer kit={kit} viewport={viewport} />}
          <MaskLayer />
          <OcrOverlay draft={draft} pending={props.ocrPending} />
        </KStage>
      )}
      <TextEditOverlay kit={kit} />
    </div>
  );
});

/** Textarea phủ đúng vị trí/xoay/cỡ chữ của box; blur hoặc Ctrl/Cmd+Enter = lưu, Esc = huỷ. */
function TextEditOverlay({ kit }: { kit: FontKit }) {
  const editing = useEditor((s) => s.editing);
  const box = useEditor((s) => (s.editing ? s.doc?.text_boxes.find((b) => b.id === s.editing) : undefined));
  const view = useEditor((s) => s.view);
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) return;
    cancelled.current = false;
    ref.current?.focus();
    ref.current?.select();
  }, [editing]);

  if (!editing || !box) return null;
  const k = view.scale;
  const commit = (value: string) => {
    const s = editorStore.getState();
    s.setEditing(null);
    if (cancelled.current || !s.layout || value.normalize("NFC") === box.text) return;
    s.apply(editText(box.id, value, s.layout));
  };
  return (
    <textarea
      ref={ref}
      aria-label="Sửa chữ"
      className="ed-textedit"
      defaultValue={box.text}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
      }}
      style={{
        left: view.x + box.x * k,
        top: view.y + box.y * k,
        width: box.w * k,
        height: box.h * k,
        transform: `rotate(${box.rotation}deg)`,
        font: `${box.font_size * k}px "${box.font_family}"`,
        lineHeight: `${lineStep(kit.metrics(box.font_family), box.font_size, box.line_height) * k}px`,
        padding: box.pad * k,
        textAlign: box.align,
        color: box.fill,
      }}
    />
  );
}
