/**
 * Ảnh 1 page trên strip chương: nền trắng + TileLayer (ảnh sạch / ảnh gốc) đặt tại `offset`, vùng nhìn đổi sang
 * toạ độ page. Chỉ mount cho page trong tầm nhìn (≤ 4, xem strip-layout.visiblePages) — unmount thì TileLayer
 * `close()` mọi bitmap.
 */
import { Group, Line, Rect } from "react-konva";
import { TileLayer } from "./TileLayer.tsx";

export type SlotImages = { original: string; clean: string | null; cleanRev: number | null };
type Rect4 = { x: number; y: number; w: number; h: number };

export function PageSlot(props: {
  pageId: string;
  size: { w: number; h: number };
  offset: number;
  images: SlotImages | undefined;
  /** Vùng nhìn theo toạ độ page. */
  viewport: Rect4;
  showOriginal: boolean;
  /** Đã từng xem ảnh gốc → giữ layer gốc (bật/tắt không tải + giải mã lại). */
  keepOriginal: boolean;
  onImageError(msg: string | null): void;
}) {
  const { pageId, size, images } = props;
  const showClean = !props.showOriginal && !!images?.clean;
  return (
    <Group y={props.offset}>
      <Rect x={0} y={0} width={size.w} height={size.h} fill="#ffffff" />
      {images?.clean && (
        <TileLayer
          url={images.clean}
          revKey={`clean:${pageId}:${images.cleanRev}`}
          page={size}
          viewport={props.viewport}
          visible={showClean}
          onError={props.onImageError}
        />
      )}
      {images && (!showClean || props.keepOriginal) && (
        <TileLayer
          url={images.original}
          revKey={`original:${pageId}`}
          page={size}
          viewport={props.viewport}
          visible={!showClean}
          onError={props.onImageError}
        />
      )}
      {props.offset > 0 && (
        <Line points={[0, 0, size.w, 0]} stroke="#9a9a96" strokeWidth={1} strokeScaleEnabled={false} />
      )}
    </Group>
  );
}
