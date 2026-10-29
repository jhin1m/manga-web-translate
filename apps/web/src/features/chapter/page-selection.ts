/**
 * Chọn nhiều trang ở cột trang để dịch riêng: ⌘-click (macOS) / Ctrl-click (nơi khác) bật/tắt 1 trang (và làm neo),
 * Shift-click chọn dải từ neo — gợi ý theo nền tảng ở page-status.ts `selectHint`. Chỉ trang hiện, không bận, đã xoá chữ + OCR (chờ dịch / xong / lỗi — server kiểm lại có OCR). Trang chọn rồi
 * mới bận (vào lượt dịch) tự rơi khỏi `selectionIds`. Thuần.
 */
import type { ProgressPage } from "./api.ts";
import { isPageBusy } from "./page-status.ts";

export type Selection = { ids: ReadonlySet<string>; anchor: string | null };

export const EMPTY_SELECTION: Selection = { ids: new Set(), anchor: null };

const PICKABLE = new Set<ProgressPage["status"]>(["prepared", "ready", "failed"]);

/** Trang lỗi lúc xoá chữ + OCR (job cuối là `page.prepare`) chưa có OCR — server từ chối cả lượt (409). */
export const selectablePage = (p: Pick<ProgressPage, "status" | "skipped" | "translate_queued" | "job">) =>
  !p.skipped && PICKABLE.has(p.status) && !isPageBusy(p) && !(p.status === "failed" && p.job?.type === "page.prepare");

const byOrd = (pages: ProgressPage[]) => [...pages].sort((a, b) => a.ord - b.ord);

export function clickSelect(
  sel: Selection,
  pages: ProgressPage[],
  id: string,
  mod: { shift: boolean; toggle: boolean },
): Selection {
  const list = byOrd(pages);
  const to = list.findIndex((p) => p.id === id);
  const target = list[to];
  if (!target) return sel;
  const from = sel.anchor ? list.findIndex((p) => p.id === sel.anchor) : -1;
  if (mod.shift && from >= 0) {
    const [a, b] = from < to ? [from, to] : [to, from];
    const ids = list
      .slice(a, b + 1)
      .filter(selectablePage)
      .map((p) => p.id);
    return { ids: new Set(ids), anchor: sel.anchor };
  }
  const ids = new Set(sel.ids);
  if (ids.has(id)) ids.delete(id);
  else if (selectablePage(target)) ids.add(id);
  return { ids, anchor: id };
}

/** Id trang đang chọn theo thứ tự trang, đã lọc trang không còn chọn được. */
export const selectionIds = (sel: Selection, pages: ProgressPage[]) =>
  byOrd(pages)
    .filter((p) => sel.ids.has(p.id) && selectablePage(p))
    .map((p) => p.id);
