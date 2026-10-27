/**
 * Xung đột sau khi lưu bị 409 (hoặc khôi phục phiên trước): server đã đổi đúng chỗ mình sửa. Không có nút
 * "ghi đè tất cả" — từng mục chọn khôi phục bản của mình (thành thao tác thường, có undo) hoặc bỏ.
 */
import type { Conflict } from "../rebase.ts";
import { editorStore, useEditor } from "../store.ts";

const REASON: Record<Conflict["reason"], string> = {
  deleted_on_server: "Bản trên server (tab khác) đã xoá mục bạn đang sửa",
  changed_on_server: "Bản trên server (tab khác) đã sửa cùng chỗ",
  removed_but_changed: "Bạn xoá mục mà người khác vừa sửa",
  id_exists: "Mục bạn thêm đã có ở bản mới với nội dung khác",
};

function describe(c: Conflict) {
  const op = c.op;
  if (op.t === "root") return `Thiết lập trang (${op.field})`;
  const what = op.coll === "text_boxes" ? "Khung chữ" : "Vùng";
  const ent = op.t === "add" ? op.entity : op.t === "update" ? op.local : op.from;
  const text = "text" in ent ? ent.text : ent.translation;
  return `${what} “${text.slice(0, 40) || ent.id}”${c.fields ? ` · ${c.fields.join(", ")}` : ""}`;
}

export function ConflictList() {
  const conflicts = useEditor((s) => s.conflicts);
  const readOnly = useEditor((s) => !!s.readOnly);
  if (conflicts.length === 0) return null;
  const st = editorStore.getState();
  return (
    <section className="notice danger ed-conflicts">
      <strong>{conflicts.length} thay đổi chưa áp được</strong>
      <p className="small muted">Bản trên server mới hơn. Các thay đổi khác của bạn đã được áp lại tự động.</p>
      <ul>
        {conflicts.map((c) => (
          <li key={c.key}>
            <div>
              <div>{describe(c)}</div>
              <div className="small muted">{REASON[c.reason]}</div>
            </div>
            <button type="button" disabled={readOnly} onClick={() => st.resolveConflict(c.key, true)}>
              Khôi phục bản của tôi
            </button>
            <button type="button" className="btn-ghost" onClick={() => st.resolveConflict(c.key, false)}>
              Bỏ
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
