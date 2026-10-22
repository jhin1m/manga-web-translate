/**
 * Điều khiển nổi trên canvas màn chương: góc dưới trái "‹ Trang n / M ›" (cùng phím ←/→), góc dưới phải "Vừa khung" ·
 * "100%" + mức zoom hiện tại. Vừa khung = khung nhìn mở trang (bỏ cờ đã zoom); 100% = đầu trang sát mép trên ở mức 1,
 * giữ khi đổi trang (chapterStore.fitView).
 */
import { chapterStore, useChapterStore } from "../editor/chapter-store.ts";
import { useEditor } from "../editor/store.ts";
import { ChevronLeftIcon, ChevronRightIcon } from "./tool-icons.tsx";

export function CanvasPager(props: { onStep(dir: -1 | 1): void }) {
  const total = useChapterStore((s) => s.pages.length);
  const ord = useChapterStore((s) => s.pages.findIndex((p) => p.id === s.activePageId));
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
      <span>
        Trang {ord >= 0 ? ord + 1 : "–"} / {total || "–"}
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
    </div>
  );
}

export function CanvasZoom() {
  const scale = useEditor((s) => s.view.scale);
  const zoomed = useChapterStore((s) => s.zoomed);
  return (
    <div className="cw-zoom">
      <button
        type="button"
        aria-pressed={!zoomed}
        title="Vừa khung: cả trang trong khung nhìn"
        onClick={() => chapterStore.getState().fitView()}
      >
        Vừa khung
      </button>
      <button
        type="button"
        aria-pressed={zoomed && scale === 1}
        title="Cỡ thật (100%), giữ khi đổi trang"
        onClick={() => chapterStore.getState().fitView(1)}
      >
        100%
      </button>
      <span className="mono" title="Mức zoom">
        {Math.round(scale * 100)}%
      </span>
    </div>
  );
}
