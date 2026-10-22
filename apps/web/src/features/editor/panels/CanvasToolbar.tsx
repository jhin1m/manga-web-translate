/**
 * Hàng công cụ cố định phía trên canvas màn chương (không đè ảnh): công cụ (V/T/B/E/R), hoàn tác/làm lại.
 * Phía dưới canvas: trang trước/sau + trang đang xem + mức zoom.
 */
import { useChapterStore } from "../chapter-store.ts";
import { editorStore, type Tool, useEditor } from "../store.ts";

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: "select", label: "Chọn", key: "V" },
  { id: "text", label: "Chữ", key: "T" },
  { id: "brush", label: "Mask", key: "B" },
  { id: "eraser", label: "Tẩy", key: "E" },
  { id: "ocr", label: "OCR vùng", key: "R" },
];

export function CanvasToolbar() {
  const tool = useEditor((s) => s.tool);
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const readOnly = useEditor((s) => s.readOnly);
  const st = editorStore.getState();
  return (
    <div className="cw-tools" role="toolbar" aria-label="Công cụ">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={tool === t.id}
          className={tool === t.id ? "ed-tool on" : "ed-tool"}
          disabled={!!readOnly && t.id !== "select"}
          onClick={() => st.setTool(t.id)}
          title={`${t.label} (${t.key})`}
        >
          {t.label} <kbd>{t.key}</kbd>
        </button>
      ))}
      <span className="cw-sep" />
      <button type="button" onClick={st.undo} disabled={!canUndo || !!readOnly} title="Hoàn tác (Ctrl/Cmd+Z)">
        Hoàn tác
      </button>
      <button type="button" onClick={st.redo} disabled={!canRedo || !!readOnly} title="Làm lại (Ctrl/Cmd+Shift+Z)">
        Làm lại
      </button>
    </div>
  );
}

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
