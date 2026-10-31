/**
 * 1 TextBox = Group (xoay quanh tâm box) + Shape tự vẽ chữ theo hợp đồng layout — KHÔNG dùng Konva.Text
 * (baseline của nó theo metric trình duyệt). Baseline/x từ linePlacements (metric file font), stroke ra ngoài:
 * lineWidth = 2·w, lineJoin round, strokeText trước rồi fillText đè.
 */
import type { TextBox } from "@mtl/shared";
import type Konva from "konva";
import { memo } from "react";
import { Group, Rect, Shape } from "react-konva";
import { canvasFont, type FontKit } from "../fonts.ts";
import { linePlacements } from "../measure.ts";
import { SELECT_STROKE } from "./colors.ts";

type Props = {
  box: TextBox;
  kit: FontKit;
  draggable: boolean;
  selected: boolean;
  onSelect(id: string): void;
  onDragEnd(id: string, x: number, y: number): void;
  onEdit(id: string): void;
};

/**
 * Box như canvas vẽ: box auto chưa có lines (chưa qua editor) được wrap bằng typesetter — chỉ hiển thị, không ghi state;
 * worker export làm y hệt (docs/typeset-layout-contract.md). Ô sửa chữ dùng cùng box này để chữ không nhảy khi mở.
 */
export function drawnBox(box: TextBox, kit: FontKit): TextBox {
  return box.lines.length === 0 && box.text.trim() !== "" ? { ...box, ...kit.layout(box) } : box;
}

/** Vẽ chữ của box vào context gốc = góc trái-trên box (chưa xoay). Dùng chung cho Shape và test parity. */
export function drawBoxText(ctx: Konva.Context, box: TextBox, kit: FontKit) {
  const drawn = drawnBox(box, kit);
  const lines = linePlacements(drawn, kit.metrics(box.font_family), kit.measure);
  ctx.setAttr("font", canvasFont(box.font_family, drawn.font_size));
  ctx.setAttr("textBaseline", "alphabetic");
  ctx.setAttr("textAlign", "left");
  const sw = box.stroke && box.stroke.width > 0 ? box.stroke.width : 0;
  if (sw > 0 && box.stroke) {
    ctx.setAttr("lineWidth", 2 * sw);
    ctx.setAttr("lineJoin", "round");
    ctx.setAttr("strokeStyle", box.stroke.color);
    for (const l of lines) ctx.strokeText(l.text, l.x, l.baseline);
  }
  ctx.setAttr("fillStyle", box.fill);
  for (const l of lines) ctx.fillText(l.text, l.x, l.baseline);
}

export const TextBoxNode = memo(function TextBoxNode({
  box,
  kit,
  draggable,
  selected,
  onSelect,
  onDragEnd,
  onEdit,
}: Props) {
  const { w, h } = box;
  return (
    <Group
      id={box.id}
      name="text-box"
      x={box.x + w / 2}
      y={box.y + h / 2}
      offsetX={w / 2}
      offsetY={h / 2}
      rotation={box.rotation}
      draggable={draggable}
      opacity={box.hidden ? 0.25 : 1}
      onMouseDown={() => onSelect(box.id)}
      onTap={() => onSelect(box.id)}
      onDblClick={() => onEdit(box.id)}
      onDblTap={() => onEdit(box.id)}
      onDragEnd={(e) => onDragEnd(box.id, e.target.x() - w / 2, e.target.y() - h / 2)}
    >
      <Shape
        width={w}
        height={h}
        sceneFunc={(ctx) => drawBoxText(ctx, box, kit)}
        hitFunc={(ctx, shape) => {
          ctx.beginPath();
          ctx.rect(0, 0, w, h);
          ctx.closePath();
          ctx.fillStrokeShape(shape);
        }}
      />
      {!selected && (
        <Rect
          width={w}
          height={h}
          stroke={SELECT_STROKE}
          strokeWidth={1}
          strokeScaleEnabled={false}
          dash={[4, 4]}
          opacity={0.35}
          listening={false}
        />
      )}
    </Group>
  );
});
