/**
 * Kết quả AI mới cho page đã sửa tay (ai_update_available): banner + diff theo vùng (bản hiện tại vs AI mới),
 * áp từng vùng hoặc tất cả — mỗi lần áp là thao tác editor thường (undo được, đi qua save). "Đã xem" tắt cờ
 * ở server (ack theo ai_rev). Chỉnh sửa tay không bị ghi đè nếu không bấm áp.
 */
import { useState } from "react";
import { type MessageKey, useT } from "../../../i18n/t.ts";
import { errorMessage } from "../../../lib/api.ts";
import { applyRegionTranslation, diffRegions } from "../actions.ts";
import { ackAiUpdate } from "../api.ts";
import { editorStore, useEditor } from "../store.ts";

const KIND: Record<"changed" | "added" | "removed", MessageKey> = {
  changed: "editor.aiUpdate.kind.changed",
  added: "editor.aiUpdate.kind.added",
  removed: "editor.aiUpdate.kind.removed",
};

export function AiUpdatePanel() {
  const { t, tp } = useT();
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
      const r = await ackAiUpdate(pageId, ai.rev);
      st.setAi({ available: r.ai_update_available, rev: r.ai_rev });
      if (r.ai_update_available) setError(t("editor.aiUpdate.newer"));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const applicable = diff.filter((d) => d.kind !== "removed").map((d) => d.id);

  return (
    <section className="notice info ed-ai">
      <div className="ed-ai-head">
        <strong>{t("editor.aiUpdate.title")}</strong>
        <span className="muted small">{tp("editor.aiUpdate.diffSummary", diff.length)}</span>
        <button type="button" className="btn-ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? t("editor.aiUpdate.collapse") : t("editor.aiUpdate.showDiff")}
        </button>
      </div>
      {open && (
        <ul className="ed-diff">
          {diff.map((d) => (
            <li key={d.id}>
              <span className="status" data-tone="idle">
                {t(KIND[d.kind])}
              </span>
              <div className="ed-diff-body">
                {d.current && <div className="ed-old">{d.current.translation || "—"}</div>}
                {d.ai && <div className="ed-new">{d.ai.translation || "—"}</div>}
              </div>
              {d.kind !== "removed" && (
                <button type="button" disabled={readOnly} onClick={() => apply([d.id])}>
                  {t("editor.aiUpdate.apply")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="ed-actions">
        <button type="button" disabled={readOnly || applicable.length === 0} onClick={() => apply(applicable)}>
          {t("editor.aiUpdate.applyAll", { count: applicable.length })}
        </button>
        <button type="button" className="btn-ghost" onClick={() => void ack()}>
          {t("editor.aiUpdate.dismiss")}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </section>
  );
}
