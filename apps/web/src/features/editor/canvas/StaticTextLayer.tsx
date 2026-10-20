/**
 * Chữ của page KHÔNG active (chỉ đọc, từ `chapterStore.cache`): cùng `TextBoxNode` với page đang sửa nên vẽ
 * y hệt, nhưng không nhận sự kiện — bấm vào page = kích hoạt page đó (ChapterCanvas xử lý).
 */
import type { TextBox } from "@mtl/shared";
import { Group } from "react-konva";
import type { FontKit } from "../fonts.ts";
import { TextBoxNode } from "./TextBoxNode.tsx";
import { boxInView } from "./TextLayer.tsx";

const noop = () => undefined;

export function StaticTextLayer(props: {
  kit: FontKit;
  boxes: TextBox[];
  offset: number;
  /** Vùng nhìn theo toạ độ page. */
  viewport: { y: number; h: number };
}) {
  const { viewport } = props;
  return (
    <Group y={props.offset} listening={false}>
      {props.boxes
        .filter((b) => boxInView(b, viewport.y, viewport.y + viewport.h))
        .map((b) => (
          <TextBoxNode
            key={b.id}
            box={b}
            kit={props.kit}
            draggable={false}
            selected={false}
            onSelect={noop}
            onDragEnd={noop}
            onEdit={noop}
          />
        ))}
    </Group>
  );
}
