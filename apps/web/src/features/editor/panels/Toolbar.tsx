/** Thanh trên editor (44px): quay lại, trang, công cụ, undo/redo, trước/sau, zoom, trạng thái lưu, về bản AI. */
import { Link } from "@tanstack/react-router";
import { resetToAI } from "../actions.ts";
import { editorStore, type Tool, useEditor } from "../store.ts";

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: "select", label: "Chọn", key: "V" },
  { id: "text", label: "Chữ", key: "T" },
  { id: "brush", label: "Mask", key: "B" },
  { id: "eraser", label: "Tẩy", key: "E" },
  { id: "ocr", label: "OCR vùng", key: "O" },
];

const SAVE_LABEL = { saved: "Đã lưu", dirty: "Chưa lưu", saving: "Đang lưu…", error: "Lỗi lưu" } as const;
const SAVE_TONE = { saved: "ok", dirty: "idle", saving: "busy", error: "danger" } as const;

export function Toolbar(props: {
  ws: string;
  seriesId: string;
  chapterId: string;
  ord: number | null;
  total: number;
  onPrev(): void;
  onNext(): void;
  onBack(): void;
}) {
  const tool = useEditor((s) => s.tool);
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const showOriginal = useEditor((s) => s.showOriginal);
  const scale = useEditor((s) => s.view.scale);
  const save = useEditor((s) => s.save);
  const readOnly = useEditor((s) => s.readOnly);
  const ai = useEditor((s) => s.ai.state);
  const st = editorStore.getState();
  const idx = props.ord === null ? null : props.ord + 1;

  return (
    <header className="ed-top">
      <Link
        to="/w/$ws/s/$seriesId/c/$chapterId"
        params={{ ws: props.ws, seriesId: props.seriesId, chapterId: props.chapterId }}
        className="btn btn-ghost"
        onClick={(e) => {
          // Lưu xong rồi mới rời (giữ href cho mở tab mới).
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          props.onBack();
        }}
      >
        ← Chương
      </Link>
      <div className="ed-group">
        <button type="button" onClick={props.onPrev} disabled={!idx || idx <= 1} title="Trang trước (←)">
          ←
        </button>
        <span className="ed-pageno">
          Trang {idx ?? "–"}/{props.total || "–"}
        </span>
        <button type="button" onClick={props.onNext} disabled={!idx || idx >= props.total} title="Trang sau (→)">
          →
        </button>
      </div>
      <div className="ed-group" role="toolbar" aria-label="Công cụ">
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
      </div>
      <div className="ed-group">
        <button type="button" onClick={st.undo} disabled={!canUndo || !!readOnly} title="Hoàn tác (Ctrl/Cmd+Z)">
          Hoàn tác
        </button>
        <button type="button" onClick={st.redo} disabled={!canRedo || !!readOnly} title="Làm lại (Ctrl/Cmd+Shift+Z)">
          Làm lại
        </button>
      </div>
      <div className="ed-group">
        <button
          type="button"
          aria-pressed={showOriginal}
          onClick={() => st.setShowOriginal(!showOriginal)}
          title="So sánh ảnh gốc (\)"
        >
          {showOriginal ? "Đang xem: ảnh gốc" : "Đang xem: bản dịch"}
        </button>
        <span className="ed-zoom mono">{Math.round(scale * 100)}%</span>
      </div>
      <span className="spacer" />
      <span className="status" data-tone={SAVE_TONE[save.status]} title={save.error ?? undefined}>
        {SAVE_LABEL[save.status]}
      </span>
      <button
        type="button"
        className="btn-danger"
        disabled={!ai || !!readOnly}
        onClick={() => ai && st.apply(resetToAI(ai))}
        title="Thay toàn bộ chỉnh sửa trang này bằng kết quả AI (hoàn tác được)"
      >
        Về bản AI
      </button>
    </header>
  );
}
