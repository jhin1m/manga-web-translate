/**
 * Lớp phủ trên ảnh gốc ở màn chương nháp: dải bị cắt (mép trên / dưới) phủ mờ, và khi đang cắt thì thêm 2 thanh kéo.
 * Mọi số đo theo pixel ảnh thật (`height` = naturalHeight); vị trí trên màn hình là phần trăm chiều cao ảnh nên không
 * phụ thuộc cỡ hiển thị. Thanh kéo là slider: chuột / cảm ứng kéo trực tiếp (pointer events), bàn phím ↑/↓ = 1 px
 * ảnh thật, Shift = 10 px (Enter / Esc do viewer bắt ở mức cửa sổ).
 */
import { type KeyboardEvent, type PointerEvent, type RefObject, useEffect, useRef } from "react";

export type TrimEdge = "top" | "bottom";

const KEY_STEP = 1;
const KEY_STEP_FAST = 10;
const pct = (px: number, height: number) => `${(px / height) * 100}%`;

export function SourceTrimOverlay(props: {
  /** Chiều cao ảnh thật (px). */
  height: number;
  top: number;
  bottom: number;
  /** Đang kéo: hiện thanh kéo; không thì chỉ phủ mờ dải đã cắt. */
  editing: boolean;
  /** Phần tử có đúng chiều cao ảnh đang hiển thị — gốc quy đổi toạ độ con trỏ. */
  frame: RefObject<HTMLElement | null>;
  onChange(edge: TrimEdge, value: number): void;
}) {
  const { height, top, bottom } = props;
  return (
    <>
      {top > 0 && <div className="cw-trim-shade" data-edge="top" style={{ height: pct(top, height) }} />}
      {bottom > 0 && <div className="cw-trim-shade" data-edge="bottom" style={{ height: pct(bottom, height) }} />}
      {props.editing && (
        <>
          <TrimHandle edge="top" at={top} height={height} frame={props.frame} onChange={props.onChange} />
          <TrimHandle
            edge="bottom"
            at={height - bottom}
            height={height}
            frame={props.frame}
            onChange={props.onChange}
          />
        </>
      )}
    </>
  );
}

/** `at` = vị trí đường cắt tính từ đỉnh ảnh (px ảnh thật): `top` với thanh trên, `height − bottom` với thanh dưới. */
function TrimHandle(props: {
  edge: TrimEdge;
  at: number;
  height: number;
  frame: RefObject<HTMLElement | null>;
  onChange(edge: TrimEdge, value: number): void;
}) {
  const { edge, at, height } = props;
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  // Vào chế độ cắt: focus thanh trên để bàn phím dùng được ngay.
  useEffect(() => {
    if (edge === "top") ref.current?.focus({ preventScroll: true });
  }, [edge]);

  /** Đặt số px cắt của thanh này theo vị trí đường cắt `y` (px ảnh thật, tính từ đỉnh ảnh). */
  const setLine = (y: number) => props.onChange(edge, edge === "top" ? y : height - y);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    dragging.current = true;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = props.frame.current?.getBoundingClientRect();
    if (!dragging.current || !box || box.height <= 0) return;
    setLine(((e.clientY - box.top) / box.height) * height);
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_STEP_FAST : KEY_STEP;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") setLine(at + (e.key === "ArrowDown" ? step : -step));
    else return;
    // Phím mũi tên không được lan ra phím tắt màn chương (đổi ảnh / cuộn).
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={ref}
      className="cw-trim-handle"
      data-edge={edge}
      style={{ top: pct(at, height) }}
      role="slider"
      tabIndex={0}
      aria-label={edge === "top" ? "Mép trên" : "Mép dưới"}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={height}
      aria-valuenow={at}
      aria-valuetext={`${edge === "top" ? at : height - at} px bị cắt`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    />
  );
}
