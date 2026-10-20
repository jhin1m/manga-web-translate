/** Bảng tra phím tắt màn chương (`?`), cùng nguồn với bảng phím ở `editor/shortcuts.ts`. */
import { Drawer } from "../../app/drawer.tsx";
import { SHORTCUT_HELP } from "../editor/shortcuts.ts";

export function ShortcutHelp({ onClose }: { onClose(): void }) {
  return (
    <Drawer title="Phím tắt" onClose={onClose}>
      <p className="muted small" style={{ margin: 0 }}>
        Phím đơn không chạy khi đang gõ trong ô; Ctrl/Cmd+S và Ctrl/Cmd+F chạy cả khi đang gõ.
      </p>
      <table className="drawer-keys">
        <tbody>
          {SHORTCUT_HELP.map((r) => (
            <tr key={r.keys}>
              <td>{r.keys}</td>
              <td>{r.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Drawer>
  );
}
