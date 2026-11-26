/**
 * Xung đột sau khi lưu bị 409 (hoặc khôi phục phiên trước): server đã đổi đúng chỗ mình sửa. Không có nút
 * "ghi đè tất cả" — từng mục chọn khôi phục bản của mình (thành thao tác thường, có undo) hoặc bỏ.
 */
import { type MessageKey, t, tp, useT } from "../../../i18n/t.ts";
import type { Conflict } from "../rebase.ts";
import { editorStore, useEditor } from "../store.ts";

const REASON: Record<Conflict["reason"], MessageKey> = {
  deleted_on_server: "editor.conflictList.reason.deleted_on_server",
  changed_on_server: "editor.conflictList.reason.changed_on_server",
  removed_but_changed: "editor.conflictList.reason.removed_but_changed",
  id_exists: "editor.conflictList.reason.id_exists",
};

function describe(c: Conflict) {
  const op = c.op;
  if (op.t === "root") return t("editor.conflictList.pageSetting", { field: op.field });
  const what = op.coll === "text_boxes" ? t("editor.conflictList.textBox") : t("editor.conflictList.region");
  const ent = op.t === "add" ? op.entity : op.t === "update" ? op.local : op.from;
  const text = "text" in ent ? ent.text : ent.translation;
  return `${what} “${text.slice(0, 40) || ent.id}”${c.fields ? ` · ${c.fields.join(", ")}` : ""}`;
}

export function ConflictList() {
  useT();
  const conflicts = useEditor((s) => s.conflicts);
  const readOnly = useEditor((s) => !!s.readOnly);
  if (conflicts.length === 0) return null;
  const st = editorStore.getState();
  return (
    <section className="notice danger ed-conflicts">
      <strong>{tp("editor.conflictList.title", conflicts.length)}</strong>
      <p className="small muted">{t("editor.conflictList.hint")}</p>
      <ul>
        {conflicts.map((c) => (
          <li key={c.key}>
            <div>
              <div>{describe(c)}</div>
              <div className="small muted">{t(REASON[c.reason])}</div>
            </div>
            <button type="button" disabled={readOnly} onClick={() => st.resolveConflict(c.key, true)}>
              {t("editor.conflictList.restoreMine")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => st.resolveConflict(c.key, false)}>
              {t("editor.conflictList.discard")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
