/**
 * Kết quả AI mới cho page đã sửa tay (ai_update_available): banner + diff theo vùng (bản hiện tại vs AI mới),
 * áp từng vùng hoặc tất cả — mỗi lần áp là thao tác editor thường (undo được, đi qua save). "Đã xem" tắt cờ
 * ở server (ack theo ai_rev). Chỉnh sửa tay không bị ghi đè nếu không bấm áp.
 */
import { useState } from "react";
import { errorMessage } from "../../../lib/api.ts";
import { applyRegionTranslation, diffRegions } from "../actions.ts";
import { ackAiUpdate } from "../api.ts";
import { editorStore, useEditor } from "../store.ts";

const KIND = { changed: "đổi", added: "mới", removed: "AI bỏ" } as const;

export function AiUpdatePanel({ ws }: { ws: string }) {
  const ai = useEditor((s) => s.ai);
  const doc = useEditor((s) => s.doc);
  const pageId = useEditor((s) => s.pageId);
  const readOnly = useEditor((s) => !!s.readOnly);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ai.available || !ai.state || !doc || !pageId) return null;

  const diff = diffRegions(doc, ai.state);
  const st = editorStore.getState();
  const apply = (ids: string[]) => {
    const layout = st.layout;
    const aiState = ai.state;
    if (!layout || !aiState) return;
    st.apply((d) => {
      for (const id of ids) applyRegionTranslation(aiState, id, layout)(d);
    });
  };
  const ack = async () => {
    setError(null);
    try {
      const r = await ackAiUpdate(ws, pageId, ai.rev);
      st.setAi({ available: r.ai_update_available, rev: r.ai_rev });
      if (r.ai_update_available) setError("Đã có kết quả AI mới hơn — xem lại danh sách.");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const applicable = diff.filter((d) => d.kind !== "removed").map((d) => d.id);

  return (
    <section className="notice info ed-ai">
      <div className="ed-ai-head">
        <strong>Có kết quả AI mới</strong>
        <span className="muted small">{diff.length} vùng khác bản hiện tại · chỉnh sửa tay được giữ nguyên</span>
        <button type="button" className="btn-ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Thu gọn" : "Xem khác biệt"}
        </button>
      </div>
      {open && (
        <ul className="ed-diff">
          {diff.map((d) => (
            <li key={d.id}>
              <span className="status" data-tone="idle">
                {KIND[d.kind]}
              </span>
              <div className="ed-diff-body">
                {d.current && <div className="ed-old">{d.current.translation || "—"}</div>}
                {d.ai && <div className="ed-new">{d.ai.translation || "—"}</div>}
              </div>
              {d.kind !== "removed" && (
                <button type="button" disabled={readOnly} onClick={() => apply([d.id])}>
                  Áp
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="ed-actions">
        <button type="button" disabled={readOnly || applicable.length === 0} onClick={() => apply(applicable)}>
          Áp tất cả ({applicable.length})
        </button>
        <button type="button" className="btn-ghost" onClick={() => void ack()}>
          Đã xem, ẩn thông báo
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </section>
  );
}
