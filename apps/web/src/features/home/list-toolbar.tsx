/**
 * Thanh xem danh sách (home, màn series): chọn tiêu chí sắp xếp, nút đảo chiều (nhãn theo nghĩa của tiêu chí: "A→Z",
 * "Mới trước"…), cặp nút Lưới / Danh sách.
 */
import { useT } from "../../i18n/t.ts";
import type { ListPrefsControl, SortOption } from "./list-prefs.ts";
import { GridIcon, ListIcon, SortDirIcon } from "./row-icons.tsx";

export function ListToolbar<K extends string>(props: {
  options: readonly SortOption<K>[];
  control: ListPrefsControl<K>;
}) {
  const { t } = useT();
  const { options, control } = props;
  const { prefs } = control;
  const option = options.find((o) => o.key === prefs.sort) ?? options[0];
  const dirLabel = option ? option[prefs.dir] : "";
  return (
    <div className="list-toolbar">
      <select
        aria-label={t("home.listToolbar.sortBy")}
        title={t("home.listToolbar.sortBy")}
        value={prefs.sort}
        onChange={(e) => control.setSort(e.target.value as K)}
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="list-dir"
        aria-label={t("home.listToolbar.dirAria", { dir: dirLabel })}
        title={t("home.listToolbar.toggleDir")}
        onClick={control.toggleDir}
      >
        <SortDirIcon dir={prefs.dir} />
        {dirLabel}
      </button>
      <fieldset className="list-view" aria-label={t("home.listToolbar.view")}>
        <button
          type="button"
          className="view-btn"
          aria-label={t("home.listToolbar.grid")}
          title={t("home.listToolbar.grid")}
          aria-pressed={prefs.view === "grid"}
          onClick={() => control.setView("grid")}
        >
          <GridIcon />
        </button>
        <button
          type="button"
          className="view-btn"
          aria-label={t("home.listToolbar.list")}
          title={t("home.listToolbar.list")}
          aria-pressed={prefs.view === "list"}
          onClick={() => control.setView("list")}
        >
          <ListIcon />
        </button>
      </fieldset>
    </div>
  );
}
