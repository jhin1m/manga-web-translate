/**
 * Lớp chữ: box trong vùng nhìn (± lề) + Transformer cho box đang chọn. Kéo/đổi khung ghi vào store khi thả
 * (1 bước undo mỗi thao tác); kích thước mới = khung × scale của Transformer, rồi trả scale về 1.
 */
import type { TextBox } from "@mtl/shared";
import type Konva from "konva";
import { useCallback, useEffect, useRef } from "react";
import { Layer, Transformer } from "react-konva";
import { moveBox, resizeBox } from "../actions.ts";
import type { FontKit } from "../fonts.ts";
import { editorStore, useEditor } from "../store.ts";
import { TextBoxNode } from "./TextBoxNode.tsx";

const MARGIN = 600;
const NO_BOXES: TextBox[] = [];

/** Box giao vùng nhìn theo trục y (box xoay: dùng đường chéo làm bán kính). */
export function boxInView(b: TextBox, top: number, bottom: number) {
  const r = Math.hypot(b.w, b.h) / 2;
  const cy = b.y + b.h / 2;
  return cy + r >= top - MARGIN && cy - r <= bottom + MARGIN;
}

export function TextLayer({ kit, viewport }: { kit: FontKit; viewport: { y: number; h: number } }) {
  const boxes = useEditor((s) => s.doc?.text_boxes ?? NO_BOXES);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const readOnly = useEditor((s) => s.readOnly);
  const layerRef = useRef<Konva.Layer>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const editable = tool === "select" && !readOnly;

  const visible = boxes.filter((b) => b.id === selection || boxInView(b, viewport.y, viewport.y + viewport.h));

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node =
      selection && editable ? layerRef.current?.findOne<Konva.Group>((n: Konva.Node) => n.id() === selection) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  });

  const onSelect = useCallback((id: string) => {
    const s = editorStore.getState();
    if (s.tool === "select") s.select(id);
  }, []);
  const onDragEnd = useCallback((id: string, x: number, y: number) => {
    editorStore.getState().apply(moveBox(id, Math.round(x * 100) / 100, Math.round(y * 100) / 100));
  }, []);
  const onEdit = useCallback((id: string) => {
    const s = editorStore.getState();
    if (s.readOnly) return;
    s.select(id);
    s.setEditing(id);
  }, []);

  const onTransformEnd = () => {
    const s = editorStore.getState();
    const node = trRef.current?.nodes()[0];
    const box = s.doc?.text_boxes.find((b) => b.id === s.selection);
    if (!node || !box || !s.layout) return;
    const w = Math.max(8, box.w * node.scaleX());
    const h = Math.max(8, box.h * node.scaleY());
    node.scale({ x: 1, y: 1 });
    const r2 = (v: number) => Math.round(v * 100) / 100;
    s.apply(
      resizeBox(
        box.id,
        { x: r2(node.x() - w / 2), y: r2(node.y() - h / 2), w: r2(w), h: r2(h), rotation: r2(node.rotation()) },
        s.layout,
      ),
    );
  };

  return (
    <Layer ref={layerRef}>
      {visible.map((b) => (
        <TextBoxNode
          key={b.id}
          box={b}
          kit={kit}
          draggable={editable}
          selected={b.id === selection}
          onSelect={onSelect}
          onDragEnd={onDragEnd}
          onEdit={onEdit}
        />
      ))}
      <Transformer
        ref={trRef}
        rotateEnabled
        keepRatio={false}
        ignoreStroke
        borderStroke="#1f4fd1"
        anchorStroke="#1f4fd1"
        anchorSize={8}
        rotationSnaps={[0, 90, 180, 270]}
        boundBoxFunc={(oldBox, newBox) => (newBox.width < 8 || newBox.height < 8 ? oldBox : newBox)}
        onTransformEnd={onTransformEnd}
      />
    </Layer>
  );
}
