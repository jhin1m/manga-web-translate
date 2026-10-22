/** Phía dưới canvas màn chương: trang trước/sau + trang đang xem + mức zoom (công cụ ở rail công cụ trái). */
import { useChapterStore } from "../chapter-store.ts";
import { useEditor } from "../store.ts";

/** Góc dưới canvas: ‹ Trang n/tổng › (cùng phím ←/→) + zoom. */
export function CanvasStatus(props: { onStep(dir: -1 | 1): void }) {
  const scale = useEditor((s) => s.view.scale);
  const total = useChapterStore((s) => s.pages.length);
  const ord = useChapterStore((s) => s.pages.findIndex((p) => p.id === s.activePageId));
  return (
    <div className="cw-canvas-foot">
      <span className="cw-pager">
        <button
          type="button"
          disabled={ord <= 0}
          onClick={() => props.onStep(-1)}
          aria-label="Trang trước"
          title="Trang trước (←)"
        >
          ‹
        </button>
        <span>
          Trang {ord >= 0 ? ord + 1 : "–"}/{total || "–"}
        </span>
        <button
          type="button"
          disabled={ord < 0 || ord >= total - 1}
          onClick={() => props.onStep(1)}
          aria-label="Trang sau"
          title="Trang sau (→)"
        >
          ›
        </button>
      </span>
      <span className="mono">{Math.round(scale * 100)}%</span>
    </div>
  );
}
