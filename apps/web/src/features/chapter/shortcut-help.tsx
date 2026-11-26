/** Bảng tra phím tắt màn chương (`?`), cùng nguồn với bảng phím ở `editor/shortcuts.ts`. */
import { Drawer } from "../../app/drawer.tsx";
import { useT } from "../../i18n/t.ts";
import { SHORTCUT_HELP } from "../editor/shortcuts.ts";

export function ShortcutHelp({ onClose }: { onClose(): void }) {
  const { t } = useT();
  return (
    <Drawer title={t("chapter.shortcutHelp.title")} onClose={onClose}>
      <p className="muted small" style={{ margin: 0 }}>
        {t("chapter.shortcutHelp.note")}
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
