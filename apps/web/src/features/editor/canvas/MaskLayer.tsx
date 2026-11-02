/**
 * Mask người vẽ (brush B / tẩy E) để xoá chữ sót bằng reinpaint. Nét lưu ở store (toạ độ page), hiển thị
 * đỏ mờ (độ mờ của cả lớp). Khi gửi: dựng PNG chỉ phủ vùng có nét (offscreen canvas ≤ 4096px/cạnh, không toDataURL cả page),
 * nền đen, nét vẽ trắng, nét tẩy đen → worker lấy pixel > 0 làm mask tại `offset`.
 */
import type Konva from "konva";
import { useEffect, useRef } from "react";
import { Circle, Group, Layer, Line } from "react-konva";
import { type MaskStroke, useEditor } from "../store.ts";

export const MAX_MASK_SIDE = 4096;

/** Độ mờ hiển thị của lớp mask (cả lớp, không phải từng nét). */
const MASK_OPACITY = "0.45";

/**
 * Nét mask của page đang sửa, đặt tại `offset` trên strip chương. Độ mờ đặt bằng CSS trên canvas của layer chứ không
 * qua prop `opacity` của Konva: prop đó nhân vào globalAlpha từng nét, nên nét tẩy (destination-out) chỉ gỡ 45% màu
 * mỗi lần kéo — vùng đã tẩy vẫn hồng dù PNG gửi đi đã sạch. Vẽ nét ở alpha 1 → tẩy là sạch hẳn, nét chồng không đậm dần.
 */
export function MaskLayer({ offset = 0 }: { offset?: number }) {
  const strokes = useEditor((s) => s.mask.strokes);
  const ref = useRef<Konva.Layer>(null);
  useEffect(() => {
    const canvas = ref.current?.getNativeCanvasElement();
    if (canvas) canvas.style.opacity = MASK_OPACITY;
  }, []);
  return (
    <Layer ref={ref} listening={false}>
      <Group y={offset}>
        {strokes.map((st, i) => (
          <Line
            // biome-ignore lint/suspicious/noArrayIndexKey: nét chỉ thêm/xoá toàn bộ, không đổi thứ tự.
            key={i}
            points={st.points}
            stroke="#dc2626"
            strokeWidth={st.size}
            lineCap="round"
            lineJoin="round"
            tension={0}
            globalCompositeOperation={st.mode === "erase" ? "destination-out" : "source-over"}
          />
        ))}
      </Group>
    </Layer>
  );
}

/**
 * Vòng tròn cỡ bút theo con trỏ (công cụ Mask / Tẩy): thấy trước nét sẽ phủ tới đâu — nét tẩy không để lại màu nên
 * thiếu vòng này thì kéo tẩy trông như không có gì xảy ra. Cập nhật thẳng node Konva (không render React mỗi lần
 * di chuột); rời canvas thì ẩn.
 */
export function BrushCursor({ mode, offset = 0 }: { mode: "brush" | "eraser"; offset?: number }) {
  const size = useEditor((s) => s.mask.size);
  const ref = useRef<Konva.Circle>(null);
  useEffect(() => {
    const c = ref.current;
    const stage = c?.getStage();
    if (!c || !stage) return;
    const move = () => {
      const p = c.getParent()?.getRelativePointerPosition();
      if (!p) return;
      c.position(p);
      c.visible(true);
      c.getLayer()?.batchDraw();
    };
    const hide = () => {
      c.visible(false);
      c.getLayer()?.batchDraw();
    };
    stage.on("pointermove.brushcursor", move);
    stage.on("pointerleave.brushcursor", hide);
    return () => {
      stage.off(".brushcursor");
    };
  }, []);
  return (
    <Layer listening={false}>
      <Group y={offset}>
        <Circle
          ref={ref}
          visible={false}
          radius={size / 2}
          stroke={mode === "brush" ? "#dc2626" : "#1f2937"}
          strokeWidth={1.5}
          strokeScaleEnabled={false}
          dash={mode === "eraser" ? [4, 3] : undefined}
          fill={mode === "eraser" ? "rgba(255,255,255,0.35)" : undefined}
        />
      </Group>
    </Layer>
  );
}

/** Khung bao các nét vẽ (nới nửa cỡ bút), cắt theo page; null nếu không có nét vẽ. */
export function strokesBounds(strokes: MaskStroke[], page: { w: number; h: number }) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const st of strokes) {
    if (st.mode !== "paint") continue;
    const r = st.size / 2 + 1;
    for (let i = 0; i + 1 < st.points.length; i += 2) {
      const x = st.points[i] as number;
      const y = st.points[i + 1] as number;
      x0 = Math.min(x0, x - r);
      y0 = Math.min(y0, y - r);
      x1 = Math.max(x1, x + r);
      y1 = Math.max(y1, y + r);
    }
  }
  if (!Number.isFinite(x0)) return null;
  const x = Math.max(0, Math.floor(x0));
  const y = Math.max(0, Math.floor(y0));
  const w = Math.min(page.w, Math.ceil(x1)) - x;
  const h = Math.min(page.h, Math.ceil(y1)) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** PNG mask theo vùng có nét + offset trên page. Vùng > 4096px/cạnh → lỗi (chia nhỏ lần vẽ). */
export async function renderMaskPng(strokes: MaskStroke[], page: { w: number; h: number }) {
  const b = strokesBounds(strokes, page);
  if (!b) throw new Error("Chưa vẽ vùng cần xoá.");
  if (b.w > MAX_MASK_SIDE || b.h > MAX_MASK_SIDE) {
    throw new Error(`Vùng vẽ quá lớn (tối đa ${MAX_MASK_SIDE}px mỗi cạnh) — xoá từng đoạn.`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = b.w;
  canvas.height = b.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D không khả dụng");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, b.w, b.h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const st of strokes) {
    ctx.strokeStyle = st.mode === "paint" ? "#fff" : "#000";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = st.size;
    const pts = st.points;
    ctx.beginPath();
    ctx.moveTo((pts[0] ?? 0) - b.x, (pts[1] ?? 0) - b.y);
    if (pts.length <= 2) {
      ctx.arc((pts[0] ?? 0) - b.x, (pts[1] ?? 0) - b.y, st.size / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    for (let i = 2; i + 1 < pts.length; i += 2) ctx.lineTo((pts[i] as number) - b.x, (pts[i + 1] as number) - b.y);
    ctx.stroke();
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  canvas.width = 0;
  if (!blob) throw new Error("Không tạo được ảnh mask.");
  return { blob, offset: [b.x, b.y] as [number, number] };
}
