/**
 * Canvas cả chương: 1 Stage bằng khung nhìn (không bao giờ bằng strip — giới hạn canvas Safari), các page xếp dọc
 * theo `offsets` và vẽ qua transform `view` (toạ độ strip). Chỉ ≤ 4 page trong tầm nhìn mount ảnh (PageSlot).
 * Page đang sửa (active) có lớp chữ/mask/OCR sửa được; page khác chỉ vẽ chữ từ cache.
 *
 * Cuộn = cuộn strip; Ctrl/Cmd+cuộn = zoom quanh con trỏ; Space giữ (hoặc chuột giữa) + kéo = kéo canvas.
 * Bấm vào page không active chỉ kích hoạt page đó (không bắt đầu công cụ). Sửa chữ = textarea HTML phủ lên box.
 */
import type { TextBox } from "@mtl/shared";
import type Konva from "konva";
import { useEffect, useRef, useState } from "react";
import { Stage as KStage, Layer } from "react-konva";
import { addBox, editText, newTextBox } from "../actions.ts";
import { activeOffset, chapterStore, useChapterStore } from "../chapter-store.ts";
import type { FontKit } from "../fonts.ts";
import { lineStep } from "../measure.ts";
import { editorStore, useEditor, type View } from "../store.ts";
import {
  clampView,
  EDGE,
  pageAt,
  screenToStrip,
  stripSize,
  stripToPage,
  viewAtOffset,
  visiblePages,
} from "../strip-layout.ts";
import { MaskLayer } from "./MaskLayer.tsx";
import { OcrOverlay, type PageRect } from "./OcrSelect.tsx";
import { PageSlot, type SlotImages } from "./PageSlot.tsx";
import { StaticTextLayer } from "./StaticTextLayer.tsx";
import { TextLayer } from "./TextLayer.tsx";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const NO_BOXES: TextBox[] = [];

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

export function ChapterCanvas(props: {
  kit: FontKit;
  images: Map<string, SlotImages>;
  defaultFont: string;
  /** Page đưa lên đầu khung khi mở chương (từ `?page=`); không có → đầu strip. */
  initialPageId: string | null;
  ocrPending: PageRect[];
  onOcr(r: PageRect): void;
  onActivate(pageId: string): void;
  onImageError(msg: string | null): void;
}) {
  const { kit } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const pages = useChapterStore((s) => s.pages);
  const offsets = useChapterStore((s) => s.offsets);
  const cache = useChapterStore((s) => s.cache);
  const view = useEditor((s) => s.view);
  const tool = useEditor((s) => s.tool);
  const showOriginal = useEditor((s) => s.showOriginal);
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
  const fitted = useRef(false);

  const strip = stripSize(pages.map((p) => ({ w: p.width, h: p.height })));
  const activeIdx = pages.findIndex((p) => p.id === activeId);
  const active = activeIdx >= 0 ? pages[activeIdx] : undefined;
  const activeOff = activeIdx >= 0 ? (offsets[activeIdx] ?? 0) : 0;

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

  // Mở chương: vừa bề ngang khung (không phóng quá 100%), page từ `?page=` (hoặc đầu strip) ở trên.
  const { initialPageId } = props;
  useEffect(() => {
    if (fitted.current || size.w === 0 || pages.length === 0) return;
    fitted.current = true;
    const s = chapterStore.getState();
    const scale = Math.min(1, Math.max(MIN_SCALE, (size.w - 2 * EDGE) / strip.w));
    const i = initialPageId ? s.pages.findIndex((p) => p.id === initialPageId) : -1;
    const v = viewAtOffset({ scale, x: 0, y: EDGE }, i >= 0 ? (s.offsets[i] ?? 0) : 0);
    editorStore.getState().setView(clampView(v, strip, size));
  }, [size, pages.length, strip, initialPageId]);

  // Page ở giữa khung nhìn (để ghi `?page=`).
  const centerY = (size.h / 2 - view.y) / view.scale;
  const centerIdx = pageAt(centerY, offsets);
  const centerId = centerIdx >= 0 ? (pages[centerIdx]?.id ?? null) : null;
  useEffect(() => {
    if (fitted.current && chapterStore.getState().centerPageId !== centerId)
      chapterStore.getState().setCenter(centerId);
  }, [centerId]);

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

  const setView = (v: View) => editorStore.getState().setView(clampView(v, strip, size));
  /** Toạ độ màn hình → toạ độ trong page active. */
  const toPage = (p: { x: number; y: number }) => stripToPage(screenToStrip(p, view), activeOff);

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const { deltaX, deltaY, ctrlKey, metaKey, shiftKey } = e.evt;
    if (ctrlKey || metaKey) {
      const p = e.target.getStage()?.getPointerPosition() ?? { x: size.w / 2, y: size.h / 2 };
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * Math.exp(-deltaY * 0.0015)));
      const at = screenToStrip(p, view);
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
    if (space || e.evt.button === 1) {
      gesture.current = { kind: "pan", ...base };
      return;
    }
    if (e.evt.button !== 0) return;
    // Bấm vào page khác → chỉ kích hoạt page đó.
    const at = screenToStrip(p, view);
    const hit = at.y >= 0 && at.y < strip.h ? pageAt(at.y, offsets) : -1;
    const hitId = hit >= 0 ? pages[hit]?.id : undefined;
    if (hitId && hitId !== activeId) {
      s.select(null);
      props.onActivate(hitId);
      return;
    }
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

  // Vùng nhìn theo toạ độ strip; mỗi page dùng bản dịch theo offset của nó.
  const viewport = { x: -view.x / view.scale, y: -view.y / view.scale, w: size.w / view.scale, h: size.h / view.scale };
  const mounted = visiblePages(
    offsets,
    pages.map((p) => p.height),
    viewport,
  );
  const local = (off: number) => ({ ...viewport, y: viewport.y - off });
  // Đã xem ảnh gốc 1 lần → giữ layer gốc của page đang mount (bật/tắt không tải lại).
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
          <Layer listening={false}>
            {mounted.map((i) => {
              const p = pages[i];
              if (!p) return null;
              const off = offsets[i] ?? 0;
              return (
                <PageSlot
                  key={p.id}
                  pageId={p.id}
                  size={{ w: p.width, h: p.height }}
                  offset={off}
                  images={props.images.get(p.id)}
                  viewport={local(off)}
                  showOriginal={showOriginal}
                  keepOriginal={originalSeen}
                  onImageError={props.onImageError}
                />
              );
            })}
            {!showOriginal &&
              mounted.map((i) => {
                const p = pages[i];
                if (!p || p.id === activeId) return null;
                const off = offsets[i] ?? 0;
                return (
                  <StaticTextLayer
                    key={p.id}
                    kit={kit}
                    boxes={cache[p.id]?.state?.text_boxes ?? NO_BOXES}
                    offset={off}
                    viewport={local(off)}
                  />
                );
              })}
          </Layer>
          {!showOriginal && active && <TextLayer kit={kit} viewport={local(activeOff)} offset={activeOff} />}
          <MaskLayer offset={activeOff} />
          <OcrOverlay draft={draft} pending={props.ocrPending} offset={activeOff} />
        </KStage>
      )}
      <TextEditOverlay kit={kit} />
    </div>
  );
}

/** Textarea phủ đúng vị trí/xoay/cỡ chữ của box; blur hoặc Ctrl/Cmd+Enter = lưu, Esc = huỷ. */
function TextEditOverlay({ kit }: { kit: FontKit }) {
  const editing = useEditor((s) => s.editing);
  const box = useEditor((s) => (s.editing ? s.doc?.text_boxes.find((b) => b.id === s.editing) : undefined));
  const view = useEditor((s) => s.view);
  const offset = useChapterStore((s) => activeOffset(s));
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
        top: view.y + (offset + box.y) * k,
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
