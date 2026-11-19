/**
 * Thanh xem danh sách (home, màn series): chọn tiêu chí sắp xếp, nút đảo chiều (nhãn theo nghĩa của tiêu chí: "A→Z",
 * "Mới trước"…), cặp nút Lưới / Danh sách.
 */
import type { ListPrefsControl, SortOption } from "./list-prefs.ts";
import { GridIcon, ListIcon, SortDirIcon } from "./row-icons.tsx";

export function ListToolbar<K extends string>(props: {
  options: readonly SortOption<K>[];
  control: ListPrefsControl<K>;
}) {
  const { options, control } = props;
  const { prefs } = control;
  const option = options.find((o) => o.key === prefs.sort) ?? options[0];
  const dirLabel = option ? option[prefs.dir] : "";
  return (
    <div className="list-toolbar">
      <select
        aria-label="Sắp xếp theo"
        title="Sắp xếp theo"
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
        aria-label={`Chiều sắp xếp: ${dirLabel} (bấm để đảo)`}
        title="Đảo chiều sắp xếp"
        onClick={control.toggleDir}
      >
        <SortDirIcon dir={prefs.dir} />
        {dirLabel}
      </button>
      <fieldset className="list-view" aria-label="Kiểu hiển thị">
        <button
          type="button"
          className="view-btn"
          aria-label="Lưới"
          title="Lưới"
          aria-pressed={prefs.view === "grid"}
          onClick={() => control.setView("grid")}
        >
          <GridIcon />
        </button>
        <button
          type="button"
          className="view-btn"
          aria-label="Danh sách"
          title="Danh sách"
          aria-pressed={prefs.view === "list"}
          onClick={() => control.setView("list")}
        >
          <ListIcon />
        </button>
      </fieldset>
    </div>
  );
}
