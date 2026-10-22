/**
 * Ảnh page đang hiện: nền trắng + TileLayer (ảnh sạch / ảnh gốc) đặt tại cột `x`. Chia đôi: page vẽ 2 lần (cột Gốc
 * bên trái, cột Dịch tại x = 0). Đổi trang = unmount → TileLayer `close()` mọi bitmap.
 *
 * Page đang chạy AI (`processing`): cột Dịch hiện ảnh gốc + lớp mờ và nhãn trạng thái thay vì ảnh sạch (bóng thoại
 * trống trông như lỗi); ảnh sạch vẫn tải ngầm để đổi ngay khi page xong.
 */
import { Group, Rect, Text } from "react-konva";
import { TileLayer } from "./TileLayer.tsx";

export type SlotImages = { original: string; clean: string | null; cleanRev: number | null };
/** Page đang chạy AI (bước 1 hoặc 2): cột Dịch hiện ảnh gốc + lớp mờ + nhãn. Page chờ dịch hiện ảnh sạch như thường. */
export type SlotProcessing = "busy";

const PROCESSING_LABEL: Record<SlotProcessing, string> = { busy: "Đang xử lý…" };
/** Cỡ nhãn trạng thái (px màn hình). */
const LABEL_PX = 15;
type Rect4 = { x: number; y: number; w: number; h: number };

export function PageSlot(props: {
  pageId: string;
  size: { w: number; h: number };
  /** Cột (toạ độ strip) — 0 trừ cột Gốc khi chia đôi. */
  x?: number;
  images: SlotImages | undefined;
  /** Vùng nhìn theo toạ độ page. */
  viewport: Rect4;
  /** Scale khung nhìn — nhãn trạng thái giữ cỡ cố định trên màn hình. */
  scale: number;
  showOriginal: boolean;
  /** Page chưa ở trạng thái xong (chỉ cột Dịch truyền). */
  processing?: SlotProcessing | null;
  /** Đã từng xem ảnh gốc → giữ layer gốc (bật/tắt không tải + giải mã lại). */
  keepOriginal: boolean;
  onImageError(msg: string | null): void;
}) {
  const { pageId, size, images } = props;
  const veil = !props.showOriginal && props.processing ? props.processing : null;
  const showClean = !props.showOriginal && !veil && !!images?.clean;
  return (
    <Group x={props.x ?? 0}>
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
      {veil && <ProcessingVeil kind={veil} size={size} viewport={props.viewport} scale={props.scale} />}
    </Group>
  );
}

/** Lớp mờ phủ page + nhãn trạng thái ở giữa phần page đang thấy. */
function ProcessingVeil(props: {
  kind: SlotProcessing;
  size: { w: number; h: number };
  viewport: Rect4;
  scale: number;
}) {
  const { size, viewport } = props;
  const fs = LABEL_PX / props.scale;
  const mid = viewport.y + viewport.h / 2;
  const y = Math.min(Math.max(mid, fs), Math.max(fs, size.h - 2 * fs)) - fs / 2;
  const text = PROCESSING_LABEL[props.kind];
  // Nền nhãn: bề ngang ước theo số ký tự (font hệ thống đậm ≈ 0.6em/ký tự) — đủ để chữ không lẫn vào ảnh.
  const padX = fs * 0.8;
  const pillW = Math.min(size.w, text.length * fs * 0.6 + 2 * padX);
  const pillH = fs * 1.9;
  return (
    <Group>
      <Rect x={0} y={0} width={size.w} height={size.h} fill="rgba(255,255,255,0.55)" />
      <Rect
        x={(size.w - pillW) / 2}
        y={y - (pillH - fs) / 2}
        width={pillW}
        height={pillH}
        cornerRadius={pillH / 2}
        fill="rgba(255,255,255,0.92)"
        stroke="rgba(0,0,0,0.12)"
        strokeWidth={1 / props.scale}
      />
      <Text
        x={0}
        y={y}
        width={size.w}
        align="center"
        text={text}
        fontSize={fs}
        fontStyle="bold"
        fontFamily="system-ui, sans-serif"
        fill="#3a3a37"
      />
    </Group>
  );
}
