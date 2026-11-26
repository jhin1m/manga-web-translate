/**
 * Cách xem danh sách series (home) và chương (màn series): lưới thẻ có ảnh hoặc danh sách hàng không ảnh, tiêu chí +
 * chiều sắp xếp. Sắp xếp làm ở web vì API trả đủ cả danh sách. Mỗi màn nhớ lựa chọn riêng trong localStorage của
 * trình duyệt; không đọc/ghi được (chế độ riêng tư) hoặc giá trị lạ → mặc định (lưới, thứ tự như API trả trước đây).
 */
import { useState } from "react";
import { collator } from "../../i18n/format.ts";
import { type MessageKey, t } from "../../i18n/t.ts";
import type { ChapterRow, SeriesListItem } from "../series/api.ts";

export type ListView = "grid" | "list";
export type SortDir = "asc" | "desc";
export type ListPrefs<K extends string> = { view: ListView; sort: K; dir: SortDir };
/** `dir`: chiều đặt sẵn khi chọn tiêu chí; `asc` / `desc`: nhãn của nút đảo chiều theo nghĩa của tiêu chí. */
export type SortOption<K extends string> = { key: K; label: string; dir: SortDir; asc: string; desc: string };

export type SeriesSort = "activity" | "title" | "created" | "chapters";
export type ChapterSort = "number" | "updated" | "created";

/** Tuỳ chọn sắp xếp; nhãn đọc theo ngôn ngữ giao diện lúc truy cập (getter). */
function sortOption<K extends string>(
  key: K,
  dir: SortDir,
  label: MessageKey,
  asc: () => string,
  desc: () => string,
): SortOption<K> {
  return {
    key,
    dir,
    get label() {
      return t(label);
    },
    get asc() {
      return asc();
    },
    get desc() {
      return desc();
    },
  };
}

const oldFirst = () => t("home.listPrefs.dir.oldFirst");
const newFirst = () => t("home.listPrefs.dir.newFirst");
const aToZ = () => "A→Z";
const zToA = () => "Z→A";

export const SERIES_SORTS: readonly SortOption<SeriesSort>[] = [
  sortOption("activity", "desc", "home.listPrefs.sort.activity", oldFirst, newFirst),
  sortOption("title", "asc", "home.listPrefs.sort.title", aToZ, zToA),
  sortOption("created", "desc", "home.listPrefs.sort.created", oldFirst, newFirst),
  sortOption(
    "chapters",
    "desc",
    "home.listPrefs.sort.chapters",
    () => t("home.listPrefs.dir.fewFirst"),
    () => t("home.listPrefs.dir.manyFirst"),
  ),
];

export const CHAPTER_SORTS: readonly SortOption<ChapterSort>[] = [
  sortOption(
    "number",
    "asc",
    "home.listPrefs.sort.number",
    () => t("home.listPrefs.dir.ascending"),
    () => t("home.listPrefs.dir.descending"),
  ),
  sortOption("updated", "desc", "home.listPrefs.sort.updated", oldFirst, newFirst),
  sortOption("created", "desc", "home.listPrefs.sort.created", oldFirst, newFirst),
];

export const SERIES_PREFS_KEY = "mtl.list.series";
export const CHAPTER_PREFS_KEY = "mtl.list.chapters";

const time = (iso: string) => Date.parse(iso) || 0;
/** Số chương là chuỗi ("10.5"): so như số, không phải số thì so chuỗi có số. */
const compareNumber = (a: string, b: string) => {
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : collator().compare(a, b);
};

/** Sắp theo `cmp` (chiều tăng) rồi đảo nếu `desc`; hoà → `id` tăng để thứ tự không nhảy giữa các lượt polling. */
function sorted<T extends { id: string }>(list: readonly T[], cmp: (a: T, b: T) => number, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => sign * cmp(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const SERIES_CMP: Record<SeriesSort, (a: SeriesListItem, b: SeriesListItem) => number> = {
  activity: (a, b) => time(a.last_activity_at) - time(b.last_activity_at),
  title: (a, b) => collator().compare(a.title, b.title),
  created: (a, b) => time(a.created_at) - time(b.created_at),
  chapters: (a, b) => a.chapter_count - b.chapter_count,
};

const CHAPTER_CMP: Record<ChapterSort, (a: ChapterRow, b: ChapterRow) => number> = {
  number: (a, b) => compareNumber(a.number, b.number),
  updated: (a, b) => time(a.updated_at) - time(b.updated_at),
  created: (a, b) => time(a.created_at) - time(b.created_at),
};

export const sortSeries = (list: readonly SeriesListItem[], sort: SeriesSort, dir: SortDir) =>
  sorted(list, SERIES_CMP[sort], dir);

export const sortChapters = (list: readonly ChapterRow[], sort: ChapterSort, dir: SortDir) =>
  sorted(list, CHAPTER_CMP[sort], dir);

export function defaultPrefs<K extends string>(options: readonly SortOption<K>[]): ListPrefs<K> {
  const first = options[0] as SortOption<K>;
  return { view: "grid", sort: first.key, dir: first.dir };
}

type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

/** Đọc lựa chọn đã nhớ; từng trường lạ / thiếu → lấy mặc định của trường đó. */
export function readPrefs<K extends string>(
  storage: PrefsStorage | undefined,
  key: string,
  options: readonly SortOption<K>[],
): ListPrefs<K> {
  const fallback = defaultPrefs(options);
  let raw: unknown;
  try {
    raw = JSON.parse(storage?.getItem(key) ?? "null");
  } catch {
    return fallback;
  }
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const option = options.find((o) => o.key === r.sort);
  return {
    view: r.view === "list" || r.view === "grid" ? r.view : fallback.view,
    sort: option ? option.key : fallback.sort,
    dir: option && (r.dir === "asc" || r.dir === "desc") ? r.dir : (option?.dir ?? fallback.dir),
  };
}

export function writePrefs<K extends string>(storage: PrefsStorage | undefined, key: string, prefs: ListPrefs<K>) {
  try {
    storage?.setItem(key, JSON.stringify(prefs));
  } catch {
    // Không ghi được (chế độ riêng tư, đầy bộ nhớ) → chỉ nhớ trong phiên này.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Lựa chọn của một màn + các thao tác đổi (đổi tiêu chí thì đặt lại chiều mặc định của tiêu chí đó). */
export function useListPrefs<K extends string>(key: string, options: readonly SortOption<K>[]) {
  const [prefs, setPrefs] = useState(() => readPrefs(safeStorage(), key, options));
  const update = (next: ListPrefs<K>) => {
    setPrefs(next);
    writePrefs(safeStorage(), key, next);
  };
  return {
    prefs,
    setView: (view: ListView) => update({ ...prefs, view }),
    setSort: (sort: K) => update({ ...prefs, sort, dir: options.find((o) => o.key === sort)?.dir ?? prefs.dir }),
    toggleDir: () => update({ ...prefs, dir: prefs.dir === "asc" ? "desc" : "asc" }),
  };
}

export type ListPrefsControl<K extends string> = ReturnType<typeof useListPrefs<K>>;
