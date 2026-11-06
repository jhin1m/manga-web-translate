/**
 * Một cụm nổi giữa đáy canvas: ‹ 3/12 › · 62% (cùng phím ←/→). Nút % đổi Vừa khung ↔ 100%: đang vừa khung → 100%
 * (đầu trang sát mép trên, giữ khi đổi trang); đang 100% → vừa khung (khung nhìn mở trang, bỏ cờ đã zoom); zoom khác
 * (Ctrl+cuộn, chụm) → 100%. Zoom tuỳ ý vẫn bằng chuột. Khi panel khối đè mép trái canvas, cụm căn giữa phần canvas còn
 * lộ (CSS `[data-cover]`) nên panel không che nút nào.
 */
import { chapterStore, useChapterStore } from "../editor/chapter-store.ts";
import { useEditor } from "../editor/store.ts";
import { ChevronLeftIcon, ChevronRightIcon } from "./tool-icons.tsx";

/** Tên + tooltip nút %: nói trạng thái hiện tại và việc bấm sẽ làm. */
export function zoomLabel(percent: number, zoomed: boolean): string {
  if (!zoomed) return `Đang vừa khung (${percent}%). Bấm để xem cỡ thật 100%`;
  if (percent === 100) return "Đang 100%. Bấm để vừa khung";
  return `Đang ${percent}%. Bấm để xem cỡ thật 100%`;
}

export function CanvasPager(props: { onStep(dir: -1 | 1): void }) {
  const total = useChapterStore((s) => s.pages.length);
  const ord = useChapterStore((s) => s.pages.findIndex((p) => p.id === s.activePageId));
  const zoomed = useChapterStore((s) => s.zoomed);
  const scale = useEditor((s) => s.view.scale);
  const percent = Math.round(scale * 100);
  const label = zoomLabel(percent, zoomed);
  return (
    <div className="cw-pager">
      <button
        type="button"
        className="icon-btn"
        disabled={ord <= 0}
        onClick={() => props.onStep(-1)}
        aria-label="Trang trước (←)"
        title="Trang trước (←)"
      >
        <ChevronLeftIcon size={16} />
      </button>
      <span className="cw-pager-pos">
        {ord >= 0 ? ord + 1 : "–"}/{total || "–"}
      </span>
      <button
        type="button"
        className="icon-btn"
        disabled={ord < 0 || ord >= total - 1}
        onClick={() => props.onStep(1)}
        aria-label="Trang sau (→)"
        title="Trang sau (→)"
      >
        <ChevronRightIcon size={16} />
      </button>
      <button
        type="button"
        className="cw-zoom-btn mono"
        data-fit={!zoomed || undefined}
        aria-label={label}
        title={label}
        onClick={() => chapterStore.getState().fitView(zoomed && percent === 100 ? undefined : 1)}
      >
        {percent}%
      </button>
    </div>
  );
}
