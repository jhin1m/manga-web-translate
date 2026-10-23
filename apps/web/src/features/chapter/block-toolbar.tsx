/**
 * Thanh thao tác nổi cạnh khối đang chọn trên canvas: Sửa chữ · Dịch lại khối · Nhân đôi khối · | · Xoá khối. Đặt trên
 * khối (khối sát mép trên khung nhìn → dưới khối), kẹp trong bề ngang canvas, đi theo khối khi cuộn/zoom
 * (page-layout.ts `blockBarPos`). Chỉ hiện khi công cụ Chọn, không đang gõ trên canvas, không chỉ xem, trang không đang
 * chạy AI và đang xem bản dịch. Nằm cùng khung với canvas (`.cw-canvas`) nên toạ độ khung nhìn dùng trực tiếp.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { deleteBox, duplicateBox } from "../editor/actions.ts";
import { effectiveMode, useChapterStore } from "../editor/chapter-store.ts";
import { blockBarPos, type Size } from "../editor/page-layout.ts";
import { editorStore, useEditor } from "../editor/store.ts";
import { isTextRegion } from "./text-table/rows.ts";
import { CopyIcon, PencilIcon, RetranslateIcon, TrashIcon } from "./tool-icons.tsx";

/** Cỡ mặc định trước lần đo đầu (4 nút 32px + vạch ngăn + đệm). */
const DEFAULT_BAR: Size = { w: 150, h: 38 };
/** Khoảng cách phía trên khối: chừa núm xoay của Transformer (`rotateAnchorOffset` 20 + núm 8, TextLayer.tsx). */
const ABOVE_GAP = 32;

export function BlockToolbar(props: {
  /** Page active đang chạy AI → không hiện. */
  processing: boolean;
  ocrBusy: boolean;
  onEdit(): void;
  onRetranslate(regionId: string): void;
}) {
  const box = useEditor((s) => (s.selection ? s.doc?.text_boxes.find((b) => b.id === s.selection) : undefined));
  const textRegion = useEditor(
    (s) => !!box?.region_id && !!s.doc?.regions.some((r) => r.id === box.region_id && isTextRegion(r)),
  );
  const view = useEditor((s) => s.view);
  const show = useEditor((s) => s.tool === "select" && !s.editing && !s.readOnly);
  const original = useChapterStore((s) => effectiveMode(s) === "original");
  const frame = useChapterStore((s) => s.box);
  const ref = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState(DEFAULT_BAR);
  const visible = !!box && show && !original && !props.processing && frame.w > 0;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!visible || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w !== bar.w || h !== bar.h) setBar({ w, h });
  });

  if (!visible || !box) return null;
  const pos = blockBarPos(box, view, frame, bar, 8, ABOVE_GAP);
  const reocrOff = !textRegion ? "Khối tự thêm không có vùng OCR để dịch lại" : props.ocrBusy ? "Đang OCR…" : undefined;
  const st = editorStore.getState();
  return (
    <div
      ref={ref}
      className="cw-blockbar"
      role="toolbar"
      aria-label="Thao tác khối"
      data-below={pos.below || undefined}
      style={{ left: pos.left, top: pos.top }}
    >
      <button
        type="button"
        className="icon-btn"
        aria-label="Sửa chữ"
        title="Sửa chữ (Enter: sửa trên ảnh)"
        onClick={props.onEdit}
      >
        <PencilIcon size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Dịch lại khối"
        title={reocrOff ?? "Dịch lại khối (nhận dạng + dịch lại vùng)"}
        disabled={!!reocrOff}
        onClick={() => box.region_id && props.onRetranslate(box.region_id)}
      >
        <RetranslateIcon size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Nhân đôi khối"
        title="Nhân đôi khối"
        onClick={() => {
          const id = `tb-${crypto.randomUUID().slice(0, 8)}`;
          st.apply(duplicateBox(box, id));
          st.select(id);
        }}
      >
        <CopyIcon size={16} />
      </button>
      <span className="cw-blockbar-sep" />
      <button
        type="button"
        className="icon-btn"
        data-danger
        aria-label="Xoá khối"
        title="Xoá khối (Delete)"
        onClick={() => st.apply(deleteBox(box.id))}
      >
        <TrashIcon size={16} />
      </button>
    </div>
  );
}
