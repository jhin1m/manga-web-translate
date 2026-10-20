/**
 * Khung canvas: Stage bằng kích thước vùng nhìn (không bao giờ bằng page — strip 12.000px+), page vẽ qua
 * transform `view` (scale + dịch). Cuộn = kéo dọc strip; Ctrl/Cmd+cuộn = zoom quanh con trỏ; Space giữ (hoặc
 * chuột giữa) + kéo = kéo canvas. Con trỏ theo công cụ: chọn/kéo box, vẽ khung chữ mới (T), vẽ mask (B/E),
 * kéo khung OCR (O). Sửa chữ = textarea HTML phủ lên box (double-click).
 */
import type Konva from "konva";
import { useEffect, useRef, useState } from "react";
import { Stage as KStage, Layer, Rect } from "react-konva";
import { addBox, editText, newTextBox } from "../actions.ts";
import type { FontKit } from "../fonts.ts";
import { lineStep } from "../measure.ts";
import { editorStore, useEditor, type View } from "../store.ts";
import { MaskLayer } from "./MaskLayer.tsx";
import { OcrOverlay, type PageRect } from "./OcrSelect.tsx";
import { TextLayer } from "./TextLayer.tsx";
import { TileLayer } from "./TileLayer.tsx";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const EDGE = 40;

type Images = { original: string; clean: string | null; cleanRev: number | null };

/** Giữ page trong tầm: page hẹp hơn khung → căn giữa ngang; không cuộn quá đầu/cuối strip. */
export function clampView(v: View, page: { w: number; h: number }, box: { w: number; h: number }): View {
  const pw = page.w * v.scale;
  const ph = page.h * v.scale;
  const x = pw + 2 * EDGE <= box.w ? (box.w - pw) / 2 : Math.min(EDGE, Math.max(box.w - pw - EDGE, v.x));
  const y = ph + 2 * EDGE <= box.h ? EDGE : Math.min(EDGE, Math.max(box.h - ph - EDGE, v.y));
  return { scale: v.scale, x, y };
}

const normRect = (a: { x: number; y: number }, b: { x: number; y: number }): PageRect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y),
});

export function EditorStage(props: {
  kit: FontKit;
  images: Images;
  page: { w: number; h: number };
  defaultFont: string;
  ocrPending: PageRect[];
  onOcr(r: PageRect): void;
  onImageError(msg: string | null): void;
}) {
  const { page, kit } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const view = useEditor((s) => s.view);
  const tool = useEditor((s) => s.tool);
  const showOriginal = useEditor((s) => s.showOriginal);
  const pageId = useEditor((s) => s.pageId);
  const [draft, setDraft] = useState<PageRect | null>(null);
  const [space, setSpace] = useState(false);
  const gesture = useRef<{
    kind: "pan" | "rect" | "paint";
    sx: number;
    sy: number;
    start: View;
    from: { x: number; y: number };
  } | null>(null);
  const fittedFor = useRef<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Mở page: vừa bề ngang khung (không phóng quá 100%), đầu strip ở trên.
  useEffect(() => {
    if (!pageId || size.w === 0 || fittedFor.current === pageId) return;
    fittedFor.current = pageId;
    const scale = Math.min(1, Math.max(MIN_SCALE, (size.w - 2 * EDGE) / page.w));
    editorStore.getState().setView(clampView({ scale, x: 0, y: EDGE }, page, size));
  }, [pageId, size, page]);

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

  const setView = (v: View) => editorStore.getState().setView(clampView(v, page, size));
  const toPage = (p: { x: number; y: number }) => ({ x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale });

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const { deltaX, deltaY, ctrlKey, metaKey, shiftKey } = e.evt;
    if (ctrlKey || metaKey) {
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
    if (space || e.evt.button === 1) {
      gesture.current = { kind: "pan", ...base };
      return;
    }
    if (e.evt.button !== 0) return;
    if (tool === "select") {
      if (e.target === stage || e.target.getLayer()?.listening() === false) s.select(null);
      return;
    }
    if (s.readOnly) return;
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
    if (g?.kind !== "rect" || !draft) return;
    setDraft(null);
    const s = editorStore.getState();
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

  const viewport = { x: -view.x / view.scale, y: -view.y / view.scale, w: size.w / view.scale, h: size.h / view.scale };
  const showClean = !showOriginal && props.images.clean;
  // Layer ảnh gốc: chỉ tải khi so sánh lần đầu, sau đó giữ (bật/tắt không tải + giải mã lại cả page).
  const [originalFor, setOriginalFor] = useState<string | null>(null);
  if (!showClean && pageId && originalFor !== pageId) setOriginalFor(pageId);
  const originalSeen = originalFor === pageId;
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
            <Rect x={0} y={0} width={page.w} height={page.h} fill="#ffffff" />
            {props.images.clean && (
              <TileLayer
                url={props.images.clean}
                revKey={`clean:${pageId}:${props.images.cleanRev}`}
                page={page}
                viewport={viewport}
                visible={!!showClean}
                onError={props.onImageError}
              />
            )}
            {(!showClean || originalSeen) && (
              <TileLayer
                url={props.images.original}
                revKey={`original:${pageId}`}
                page={page}
                viewport={viewport}
                visible={!showClean}
                onError={props.onImageError}
              />
            )}
          </Layer>
          {!showOriginal && <TextLayer kit={kit} viewport={viewport} />}
          <MaskLayer />
          <OcrOverlay draft={draft} pending={props.ocrPending} />
        </KStage>
      )}
      <TextEditOverlay kit={kit} />
    </div>
  );
}

const clipRect = (r: PageRect, page: { w: number; h: number }): PageRect => {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  return { x, y, w: Math.min(page.w, r.x + r.w) - x, h: Math.min(page.h, r.y + r.h) - y };
};

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
